# Deployment Guide

This document covers how to deploy and maintain the LDaCA Text Analytics Web Application in production.

---

## Architecture Overview

```
Internet → Nginx (80/443) → FastAPI app (localhost:8001)
```

- **Nginx** handles HTTPS termination and reverse proxies to the app
- **Let's Encrypt** (via Certbot) provides the TLS certificate
- **systemd** manages the app process (auto-start on boot, auto-restart on failure)

---

## Server Requirements

- Ubuntu 22.04+
- `nginx`
- `certbot` with `python3-certbot-nginx`
- `uv` (installed at `/home/ubuntu/.local/bin/uv`)
- DNS A record pointing the domain to the server's public IP

---

## Initial Deployment

### 1. Clone / update the app

```bash
cd /home/ubuntu/src/ldaca_wordflow
git pull
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
```

> The `git submodule update --init --recursive` step is mandatory: this
> repo embeds the `ldaca_wordflow_backend` package (along with
> `docworkspace` and `polars-text`) as git submodules, and a plain
> `git pull` only advances the *submodule pointer* in the parent tree
> without checking out the new submodule content. Skipping this leaves
> the systemd service running stale backend code while `git status`
> looks clean.

### 2. Configure Nginx

Create `/etc/nginx/sites-available/analytics.ldaca.edu.au`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name analytics.ldaca.edu.au;

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Enable the site and reload Nginx:

```bash
sudo ln -sf /etc/nginx/sites-available/analytics.ldaca.edu.au /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Obtain TLS Certificate

> **Prerequisite:** Ports 80 and 443 must be open inbound on the cloud firewall / security group.

```bash
sudo certbot --nginx -d analytics.ldaca.edu.au --non-interactive --agree-tos \
  -m admin@ldaca.edu.au --redirect
```

Certbot will automatically update the Nginx config to serve HTTPS and redirect HTTP → HTTPS.
Certificates are renewed automatically via a systemd timer — no manual renewal needed.

### 4. Install the systemd Service

The service file is located at `/etc/systemd/system/ldaca-wordflow.service`.
To install it from scratch:

```bash
sudo cp /home/ubuntu/ldaca-wordflow.service /etc/systemd/system/ldaca-wordflow.service
sudo systemctl daemon-reload
sudo systemctl enable ldaca-wordflow
sudo systemctl start ldaca-wordflow
```

The service file content:

```ini
[Unit]
Description=LDaCA Text Analytics Web Application
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/src/ldaca_wordflow/backend
Environment="MULTI_USER=true"
Environment="CILOGON_CLIENT_ID=cilogon:/client_id/3f6c0af973d3cc270a404823d3bbf122"
Environment="CILOGON_CLIENT_SECRET=_ooOmovo-g0vTwtVSziDNBuT0_mWjCmNTWN1SgeeukMQsdHUWvfHDxcJag2kb2cvJyGLV7l6ZjC--GUw-ftb2g"
Environment="CILOGON_DISCOVERY_URL=https://test.cilogon.aaf.edu.au/.well-known/openid-configuration"
Environment="CILOGON_REDIRECT_URI=https://analytics.ldaca.edu.au/api/auth/cilogon/callback"
ExecStartPre=/bin/rm -rf /home/ubuntu/src/ldaca_wordflow/backend/src/ldaca_wordflow/resources/frontend/build
ExecStartPre=/bin/tar -xzf /home/ubuntu/src/ldaca_wordflow/backend/src/ldaca_wordflow/resources/frontend/build.tar.gz -C /home/ubuntu/src/ldaca_wordflow/backend/src/ldaca_wordflow/resources/frontend
ExecStart=/home/ubuntu/.local/bin/uv run ldaca-wordflow --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> **Switching to production CILogon:** When Moises switches the registration from test to
> production, change `CILOGON_DISCOVERY_URL` to
> `https://cilogon.aaf.edu.au/.well-known/openid-configuration`.

### 5. CILogon OIDC Setup

The production deployment at `analytics.ldaca.edu.au` uses CILogon (AAF-federated OIDC)
for authentication. The OIDC client was registered by Moises (ARDC/AAF) with the following
parameters:

| Parameter      | Value                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| Client name    | `test.analytics.ldaca.edu.au`                                              |
| Callback URL   | `https://analytics.ldaca.edu.au/api/auth/cilogon/callback`                 |
| Configuration  | General LDaCA Transparent Enrollment (openid, email, profile, org.cilogon.userinfo) |
| Discovery URL  | `https://test.cilogon.aaf.edu.au/.well-known/openid-configuration` (test)  |

The client credentials are stored in the systemd service file above. No frontend changes
are needed — the login button is served dynamically based on which provider is configured.

---

## Common Admin Commands

### App Service

```bash
# Check status
sudo systemctl status ldaca-wordflow

# Start / stop / restart
sudo systemctl start ldaca-wordflow
sudo systemctl stop ldaca-wordflow
sudo systemctl restart ldaca-wordflow

# View live logs
sudo journalctl -u ldaca-wordflow -f

# View recent logs (last 100 lines)
sudo journalctl -u ldaca-wordflow -n 100 --no-pager
```

### Nginx

```bash
# Test config before applying
sudo nginx -t

# Reload config (no downtime)
sudo systemctl reload nginx

# Full restart
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

### TLS Certificate

```bash
# Check certificate expiry
sudo certbot certificates

# Manually trigger renewal (normally automatic)
sudo certbot renew --dry-run
```

---

## Release Checklist

This project has two release surfaces that must stay aligned:

- The `backend/` submodule repo publishes the Python package consumed by `uvx`.
- The root repo pins that backend release and is what the Nectar VM deploys from source.

Release from `dev`, then promote to `main`.

> **Frontend bundle rule:** `build.tar.gz` inside the backend submodule is the **sole**
> source of frontend assets for both PyPI/uvx users and the Nectar deployment. Every change
> to `frontend/src/**` — whether part of a version bump or a feature/fix branch — is
> **invisible to users** until steps 2–3 below are run and the updated `build.tar.gz` is
> committed to the backend submodule. This applies equally to full releases and to
> feature branches deployed to Nectar before a release (see
> [Deploying a feature branch to Nectar](#deploying-a-feature-branch-to-nectar) below).

> **Critical ordering rule:** All version strings **must be updated before the frontend is
> built**. Vite reads `frontend/package.json` at build time and bakes the version into the
> JS bundle as `import.meta.env.VITE_APP_VERSION` — referenced by `DocumentView.tsx` (which
> resolves `{{VERSION}}` placeholders in markdown docs at render time) and by
> `FeedbackPanel.tsx` (which ships the version as feedback context). Updating
> `package.json` after the build has no effect on what Nectar or uvx users actually see.
>
> **Note:** `frontend/public/references/general.md` itself ships with `{{VERSION}}` /
> `{{BUILD_DATE}}` placeholders verbatim — the React markdown renderer substitutes them at
> view time. Do **not** hand-edit the version literal in `general.md` (it will be
> overwritten as soon as the docs registry refreshes).

### 1. Bump all version strings + write the CHANGELOG entry (do this first, before any build)

Update the version number in every location below before touching anything else:

| File | What to change |
|---|---|
| `pyproject.toml` (root) | `version = "X.Y.Z"` — workspace metadata |
| `backend/pyproject.toml` | `version = "X.Y.Z"` |
| `frontend/package.json` | `"version": "X.Y.Z"` — Vite bakes this into the JS bundle |
| `frontend/src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` — controls desktop bundle filenames (DMG/MSI) |
| `frontend/src-tauri/Cargo.toml` | `version = "X.Y.Z"` — Rust crate metadata |
| `frontend/.env` | `VITE_DOCS_BASE_URL=https://australian-text-analytics-platform.github.io/ldaca-analytics-docs/vX.Y` — **minor version only** (e.g. `v0.4`), not patch |
| `CHANGELOG.md` | Add a new `## [X.Y.Z] — YYYY-MM-DD` section above the previous top entry, plus a matching link reference at the bottom |

> **Why `frontend/.env` is committed:** it contains only the public docs base URL — no
> secrets. It is tracked so that both the local `npm run build` (step 2) and the Tauri
> GitHub Actions build pick up the correct docs version automatically via `git checkout`.
> Secrets and local overrides belong in `frontend/.env.local`, which remains gitignored.
> If the minor version hasn't changed (patch release), this file does not need updating.

> **CHANGELOG content:** follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
> format already used by the file — group changes under `### Added` / `### Changed` /
> `### Fixed`. Skim `git log v<PREVIOUS-VERSION>..HEAD -- frontend/src backend/src` to
> remind yourself what shipped; user-facing strings (button labels, panel titles) are
> usually the easiest entry points into "what changed for the user".

Then refresh the backend lockfile:

```bash
cd /path/to/ldaca_wordflow/backend
env -u CONDA_PREFIX uv lock
```

> **Conda interop:** `maturin`, `uv build`, and `uv lock` refuse to run if both
> `VIRTUAL_ENV` and `CONDA_PREFIX` are set ("Please unset one of them"). If you have
> a conda env active, prefix the affected commands with `env -u CONDA_PREFIX`.

### 2. Build the frontend from the root repo

```bash
cd /path/to/ldaca_wordflow
npm run build -w frontend
```

### 3. Sync the built frontend into the backend package bundle

```bash
cd /path/to/ldaca_wordflow
node scripts/deploy-frontend-to-backend.mjs
```

This refreshes:

- `backend/src/ldaca_wordflow/resources/frontend/build.tar.gz`
- `backend/src/ldaca_wordflow/resources/frontend/build/`

**Verify the version literal was baked in correctly before proceeding.** Vite tree-shakes
the version string into whichever assets reference `import.meta.env.VITE_APP_VERSION`
(`DocumentView` for markdown rendering, `FeedbackPanel` for feedback context). Checking
the main `index-*.js` is not enough — grep across every bundle JS asset:

```bash
for f in $(tar -tf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz | grep -E '\.js$'); do
  hits=$(tar -xOf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz "$f" \
         | grep -cE '"?X\.Y\.Z"?')
  if [ "$hits" -gt 0 ]; then echo "$hits hits in $f"; fi
done
```

Substitute the actual `X.Y.Z` literal. Expect hits in `DocumentView-*.js` and
`FeedbackPanel-*.js` at minimum. Zero total hits means Vite ran before `package.json` was
updated — delete the build output and repeat steps 1–3.

> **Don't grep `build/references/general.md`.** That file ships the literal placeholders
> `{{VERSION}}` / `{{BUILD_DATE}}` — they're resolved at render time by `DocumentView.tsx`,
> not at build time. The bundle's general.md will always show the placeholders, so the
> file isn't useful for version verification.

**Verify any new feature strings are present in the bundle.** Pick a distinctive literal
unique to the new feature (a button label, panel title, or class name) and confirm it
ended up in the right asset:

```bash
for f in $(tar -tf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz | grep -E '\.js$'); do
  hits=$(tar -xOf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz "$f" \
         | grep -cE "SomeNewFeatureString")
  if [ "$hits" -gt 0 ]; then echo "$hits hits in $f"; fi
done
```

Zero total hits means the source change was not included in the build — do not proceed.

### 4. Validate the backend release artifact

```bash
cd /path/to/ldaca_wordflow/backend
uv build
uv run pytest -q
uvx ty check
uvx --from dist/ldaca_wordflow-<VERSION>-py3-none-any.whl ldaca-wordflow --help
```

If `uvx ty check` is already failing on unrelated, pre-existing issues, record that explicitly before releasing.

### 5. Publish the backend package repo

From the `backend/` repo, commit the release prep on `dev` first, then fast-forward (or
explicit merge) into `main` and tag from there:

```bash
cd /path/to/ldaca_wordflow/backend
git add pyproject.toml uv.lock src/ldaca_wordflow/resources/frontend/build.tar.gz
git commit -m "Release v<VERSION>"
git push origin dev

git checkout main
git pull --ff-only origin main
git merge --ff-only dev   # or --no-ff if main has diverged — see callout below
git push origin main
git tag v<VERSION>
git push origin v<VERSION>
```

The tag push triggers the backend repo's PyPI publish workflow.

> **Backend's `dev` may have diverged from `main`.** Releases historically tag from `main`,
> but some feature work has been committed to `main` directly without back-merging to
> `dev`. Before step 5, check:
>
> ```bash
> git log origin/dev..origin/main --oneline   # commits on main that dev doesn't have
> ```
>
> If non-empty, `git merge --ff-only dev` from `main` will fail with "Not possible to
> fast-forward". Switch to `git merge --no-ff dev -m "Merge dev into main: Release v<VERSION>"`
> and resolve conflicts. Expect conflicts on `pyproject.toml` (take `dev`'s version),
> `uv.lock` (take `dev`'s refreshed lock), `build.tar.gz` (take `dev`'s rebuilt bundle),
> and possibly substantive code files where both sides shipped features in the same area.
> For substantive conflicts: take both sides where they're additive, and run
> `env -u CONDA_PREFIX uv run --active pytest -q` before completing the merge commit.

### 6. Update the root repo to the new backend submodule pointer

From the root repo:

```bash
cd /path/to/ldaca_wordflow
git add CHANGELOG.md pyproject.toml backend \
    frontend/package.json \
    frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml
git commit -m "Release v<VERSION>"
git push origin dev
```

> **Submodule pin discipline when a parallel release line is active.** When the
> `multilingual` branch (or any other long-running line) is checked out locally before
> you start the `dev` release, your working tree may have the `polars-text` /
> `docworkspace` submodules pointed at multilingual-only SHAs that are **not** what `dev`
> should pin. Before staging, run:
>
> ```bash
> git submodule status   # lines starting with `+` differ from the tree's recorded SHA
> git ls-tree origin/main -- polars-text docworkspace   # what main currently pins
> ```
>
> If `git status` shows `modified: polars-text` or `modified: docworkspace` and they
> shouldn't ship in this release (e.g. they advance only because of multilingual Phase 5
> work), revert each submodule HEAD to the right SHA before staging:
>
> ```bash
> git -C polars-text checkout <release-SHA>
> git -C docworkspace checkout <release-SHA>
> ```
>
> Then `git add <submodule>` to capture the revert in the release commit. The release
> commit should bump only the submodules that were intentionally advanced for the version
> being shipped.

### 7. Verify the published `uvx` package

After the backend release workflow finishes:

```bash
uvx --refresh ldaca-wordflow@<VERSION> --help
uvx --from ldaca-wordflow==<VERSION> ldaca-wordflow --help
```

For a full smoke test:

```bash
uvx --from ldaca-wordflow==<VERSION> ldaca-wordflow --host 127.0.0.1 --port 8016
```

### 8. Merge `dev` into `main` in the root repo

```bash
cd /path/to/ldaca_wordflow
git checkout main
git pull --ff-only origin main
git merge --no-ff dev -m "Merge dev into main"
git push origin main
git tag v<VERSION>
git push origin v<VERSION>
```

Pushing the root `v<VERSION>` tag now triggers the root desktop release workflow,
which builds the Windows MSI and Apple Silicon DMG and attaches both artifacts to
the GitHub release page for that tag.

### 9. Deploy Nectar from the root repo checkout

```bash
cd /home/ubuntu/src/ldaca_wordflow
git pull
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-wordflow
```

### 10. Verify the Nectar deployment

Check git state:

```bash
cd /home/ubuntu/src/ldaca_wordflow && \
echo "root branch: $(git branch --show-current)" && \
echo "root commit: $(git rev-parse --short HEAD)" && \
echo "backend submodule: $(git submodule status backend)" && \
echo "backend commit: $(git -C backend rev-parse --short HEAD)"
```

Check served assets:

```bash
curl -s http://127.0.0.1:8001/ | grep -Eo 'assets/[A-Za-z0-9._-]+' | head -20
```

For UI regressions, also verify the bundled build contains the expected strings:

```bash
cd /home/ubuntu/src/ldaca_wordflow/backend
rg -n "Reset all hints|Topic Modelling - BERTopic|All hints have been reset" src/ldaca_wordflow/resources/frontend/build
```

---

## Deploying a Feature Branch to Nectar

Use this when a feature branch has frontend source changes and needs to be deployed to
Nectar **before** a full versioned release (e.g. testing a new auth provider in
production). These steps are required whenever `frontend/src/**` changes on a branch,
regardless of whether versions are bumped.

### 1. Rebuild the frontend bundle on the feature branch

```bash
cd /path/to/ldaca_wordflow
npm run build -w frontend
node scripts/deploy-frontend-to-backend.mjs
```

### 2. Verify the new feature is in the bundle

```bash
tar -xOf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz \
    $(tar -tf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz \
      | grep 'assets/index.*\.js' | head -1) \
  | grep -c "SomeNewFeatureString"
```

A count of `0` means the build did not include your change — stop and investigate.

### 3. Commit the updated bundle to the backend submodule branch

```bash
cd /path/to/ldaca_wordflow/backend
git add src/ldaca_wordflow/resources/frontend/build.tar.gz
git commit -m "build: rebuild frontend bundle with <feature name>"
git push origin <feature-branch>
```

### 4. Update the root repo submodule pointer

```bash
cd /path/to/ldaca_wordflow
git add backend
git commit -m "build: point backend submodule to rebuilt <feature name> bundle"
git push origin <feature-branch>
```

### 5. Deploy to Nectar

```bash
cd /home/ubuntu/src/ldaca_wordflow
git fetch origin
git checkout <feature-branch>
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-wordflow
```

---

## Updating the App

```bash
cd /home/ubuntu/src/ldaca_wordflow
git pull
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-wordflow
```

If the service still serves stale frontend assets after a restart, confirm the backend submodule matches the root repo's recorded commit. A leading `+` in `git submodule status backend` means the deployed backend checkout does not match the root repo pointer.

---

## Changing Configuration

If you need to update environment variables (e.g. `GOOGLE_CLIENT_ID`) or startup flags:

1. Edit the service file:

   ```bash
   sudo nano /etc/systemd/system/ldaca-wordflow.service
   ```

2. Reload systemd and restart the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ldaca-wordflow
   ```

---

## Troubleshooting

| Symptom                        | Check                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| App not responding             | `sudo systemctl status ldaca-wordflow` and `sudo journalctl -u ldaca-wordflow -n 50` |
| 502 Bad Gateway from Nginx     | App may be down — restart with `sudo systemctl restart ldaca-wordflow`              |
| Certificate expired            | `sudo certbot renew`                                                               |
| Port 8001 already in use       | `sudo fuser -k 8001/tcp` then start the service                                    |
| Old UI served after deploy     | Frontend source changed but `build.tar.gz` was not rebuilt — follow [Deploying a feature branch to Nectar](#deploying-a-feature-branch-to-nectar) steps 1–4, then redeploy |
| New feature missing from UI    | Verify with `grep -c "FeatureString"` against the bundle (see release step 3) — if `0`, rebuild and recommit `build.tar.gz` |
