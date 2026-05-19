# Deployment Guide

This document covers how to deploy and maintain LDaCA Wordflow in production at `analytics.ldaca.edu.au`. For the bundle / submodule model and naming conventions, see [AGENTS.md](AGENTS.md).

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
git checkout v0.5
git pull --ff-only origin v0.5
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
```

> The `git submodule update --init --recursive` step is mandatory: this repo embeds `ldaca-wordflow-backend` (along with `docworkspace`, `polars-text`, `ldaca-tabulator`) as git submodules, and a plain `git pull` only advances the *submodule pointer* in the parent tree without checking out the new submodule content. Skipping this leaves the systemd service running stale backend code while `git status` looks clean.

> **Branch policy:** Nectar tracks `v0.5` (the production line; promoted from `v0.4` after v0.5.0 shipped on 2026-05-17). `v0.4` remains as the previous production line for any back-port hot-fixes. The legacy `main` branch is parked at v0.3.x. See [Routine Updates](#routine-updates) for the normal pull-and-restart sequence after first install.

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
Description=LDaCA Wordflow
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

Two release surfaces ship together:

- The `backend/` submodule repo (`Australian-Text-Analytics-Platform/ldaca-wordflow-backend`) publishes the Python package consumed by `pip` / `uvx`. Tag on its `v0.5` branch → triggers `release.yml` → PyPI publish (`ldaca-wordflow`).
- This root repo pins that backend tag. Tag on its `v0.5` branch → triggers `release.yml` → Tauri Windows MSI + Apple Silicon DMG attached to a GitHub release. Also what the Nectar VM deploys from source.

The working branch (any name — recent releases used `perf/cjk-tokeniser`, then `feat/demo-snapshot` for v0.5.0) is the integration target; release tags are cut on the active release branch (`v0.5` for v0.5.x, `v0.4` for back-port hot-fixes to the 0.4 line) after a fast-forward.

> **Frontend bundle rule:** `build.tar.gz` inside the backend submodule is the **sole** source of frontend assets for both PyPI/uvx users and the Nectar deployment. Every `frontend/src/**` change — whether shipping in a release or hot-fixed onto a feature branch — is **invisible to users** until the bundle is rebuilt and committed. This applies equally to full releases and to feature branches deployed to Nectar before a release; see [Deploying a Feature Branch to Nectar](#deploying-a-feature-branch-to-nectar) below.

> **Version-source drift is guarded by CI.** Five files carry an independently-stamped version (workspace `pyproject.toml`, `backend/pyproject.toml`, `frontend/package.json`, `frontend/src-tauri/Cargo.toml`, `frontend/src-tauri/tauri.conf.json`). `pnpm bump-version` writes all five in one pass; the `verify-versions` job in `.github/workflows/release.yml` re-checks them on every tag push and refuses to ship if any drift. (This guard exists because v0.4.3 shipped with three files at `0.4.2`, which is what triggered the v0.4.4 re-stamp.) Don't hand-edit version strings — always use the bumper.

### 1. Bump all version strings + write the CHANGELOG entry (do this first, before any build)

From the wordflow repo root:

```bash
cd /path/to/ldaca_wordflow
pnpm bump-version X.Y.Z   # rewrites all 5 version-bearing files atomically
pnpm check-versions       # belt-and-braces: same check the CI gate runs
```

`bump-version` updates: workspace `pyproject.toml`, `backend/pyproject.toml`, `frontend/package.json`, `frontend/src-tauri/Cargo.toml`, and `frontend/src-tauri/tauri.conf.json`. It does **not** touch:

| File | When you need to edit it by hand |
|---|---|
| `frontend/.env` | Only when the **minor** version changes (e.g. `v0.4` → `v0.5`). Update `VITE_DOCS_BASE_URL=…/ldaca-wordflow-docs/vX.Y`. Patch releases don't touch this. |
| `CHANGELOG.md` | Always. Add `## [X.Y.Z] — YYYY-MM-DD` above the previous top entry. |
| `backend/uv.lock` | Always — regenerate with `env -u CONDA_PREFIX uv lock` from `backend/` after the pyproject version bump. |

> **Why `frontend/.env` is committed:** it contains only the public docs base URL — no secrets. It is tracked so that both the local `pnpm -C frontend build` and the Tauri GitHub Actions build pick up the correct docs version automatically via `git checkout`. Secrets and local overrides belong in `frontend/.env.local`, which remains gitignored.

> **CHANGELOG content:** follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format already used by the file — group under `### Added` / `### Changed` / `### Fixed`. Skim `git log v<PREVIOUS>..HEAD -- frontend/src backend/src` to remind yourself what shipped; user-facing strings (button labels, panel titles) are usually the easiest entry points into "what changed for the user".

> **Conda interop:** `maturin`, `uv build`, and `uv lock` refuse to run if both `VIRTUAL_ENV` and `CONDA_PREFIX` are set ("Please unset one of them"). If you have a conda env active, prefix those commands with `env -u CONDA_PREFIX`.

### 2. Rebuild + redeploy the frontend bundle

```bash
cd /path/to/ldaca_wordflow
pnpm deploy_frontend_to_backend
```

This single command runs `pnpm -C frontend build` and then `scripts/deploy-frontend-to-backend.mjs`, refreshing:

- `backend/src/ldaca_wordflow/resources/frontend/build.tar.gz`
- `backend/src/ldaca_wordflow/resources/frontend/build/`

**Why the order matters:** Vite reads `frontend/package.json` at build time and bakes the version into the JS bundle as `import.meta.env.VITE_APP_VERSION` — referenced by `DocumentView.tsx` (resolves `{{VERSION}}` placeholders in markdown at render time) and by `FeedbackPanel.tsx` (ships the version as feedback context). Updating `package.json` **after** the build has no effect on what users see. Running step 1 before step 2 is what guarantees the baked-in version matches the wheel metadata. (See `frontend/public/references/general.md` for the `{{VERSION}}`/`{{BUILD_DATE}}` placeholder pattern — those are resolved at render time, not build time, so don't hand-edit the literals.)

**Optional sanity grep — if anything looks off:** if you suspect Vite ran with stale state (out-of-band `vite build`, half-deleted `dist/`, etc.), spot-check that the new version literal appears in the bundle:

```bash
for f in $(tar -tf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz | grep -E '\.js$'); do
  hits=$(tar -xOf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz "$f" \
         | grep -cE '"?X\.Y\.Z"?')
  if [ "$hits" -gt 0 ]; then echo "$hits hits in $f"; fi
done
```

Expect hits in `DocumentView-*.js` and `FeedbackPanel-*.js` at minimum. Zero total hits → delete the build output and repeat steps 1–2. (In normal flow this is unnecessary — `verify-versions` in CI catches mismatches between the five source files, and the build is deterministic from those.)

If you're worried a *feature* string didn't make it in, swap the regex for a distinctive literal unique to the change (button label, panel title) and re-run.

### 3. Validate the backend release artifact

```bash
cd /path/to/ldaca_wordflow/backend
uv build
uv run pytest -q
uvx ty check
uvx --from dist/ldaca_wordflow-<VERSION>-py3-none-any.whl ldaca-wordflow --help
```

If `uvx ty check` is already failing on unrelated, pre-existing issues, record that explicitly before releasing.

### 4. Publish the backend package repo

Commit on the working branch, fast-forward `v0.5`, tag, push:

```bash
cd /path/to/ldaca_wordflow/backend
git add pyproject.toml uv.lock src/ldaca_wordflow/resources/frontend/
git commit -m "Release v<VERSION>"
git push origin <working-branch>          # e.g. feat/demo-snapshot

git checkout v0.5
git merge --ff-only <working-branch>      # should be ff-only
git push origin v0.5
git tag -a v<VERSION> v0.5 -m "Release v<VERSION>"
git push origin v<VERSION>
git checkout <working-branch>
```

The tag push triggers the backend repo's PyPI publish workflow.

<!--
> **`backend/main` is the legacy v0.3 line — do not tag there.** Recent v0.4.x tags are all cut on `v0.4`. The backend's `main` is parked at `v0.3.5` for back-compat consumers of the old `ldaca-web-app` PyPI name. Putting a v0.4.x tag on `main` would either fail PyPI's trusted-publisher check (different branch policy) or produce a wheel under the wrong name. Always tag on `v0.4`.

  ^ Commented out 2026-05-17 after v0.5.0 shipped. The `backend/main`
    branch is still parked at `v0.3.5` for back-compat — but with the
    rename complete and v0.5 the active line, no one is contemplating
    tagging there anymore. Restore + update this warning if a future
    release line ever needs to be cautioned away from `main`.
-->


### 5. Update the root repo to the new backend submodule pointer

```bash
cd /path/to/ldaca_wordflow
git add CHANGELOG.md pyproject.toml backend \
    frontend/package.json \
    frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml
git commit -m "Release v<VERSION>"
git push origin <working-branch>
```

> **Submodule pin discipline when a parallel release line is active.** If a long-running line (formerly `multilingual`; could be any future feature branch) is also checked out locally before you start the release, your working tree may have `polars-text` / `docworkspace` pointed at SHAs that are **not** what the release should pin. Before staging:
>
> ```bash
> git submodule status                              # `+` lines differ from the recorded SHA
> git ls-tree origin/v0.5 -- polars-text docworkspace   # what v0.5 currently pins
> ```
>
> If `git status` shows `modified: polars-text` or `modified: docworkspace` and they shouldn't ship in this release, revert each submodule HEAD to the right SHA before staging:
>
> ```bash
> git -C polars-text checkout <release-SHA>
> git -C docworkspace checkout <release-SHA>
> git add polars-text docworkspace
> ```
>
> The release commit should bump only the submodules that were intentionally advanced for this version.

### 6. Verify the published `uvx` package

After the backend release workflow finishes (~3–5 min for PyPI publish):

```bash
uvx --refresh ldaca-wordflow@<VERSION> --help
uvx --from ldaca-wordflow==<VERSION> ldaca-wordflow --help
```

For a full smoke test:

```bash
uvx --from ldaca-wordflow==<VERSION> ldaca-wordflow --host 127.0.0.1 --port 8016
```

### 7. Fast-forward `v0.5` on the root repo, tag, push

```bash
cd /path/to/ldaca_wordflow
git checkout v0.5
git merge --ff-only <working-branch>
git push origin v0.5
git tag -a v<VERSION> v0.5 -m "Release v<VERSION>"
git push origin v<VERSION>
git checkout <working-branch>
```

Pushing the root `v<VERSION>` tag triggers the root desktop release workflow, which runs `verify-versions` first, then builds the Windows MSI and Apple Silicon DMG and attaches both to the GitHub release page for that tag. Desktop builds take ~20–25 min.

### 8. Deploy Nectar

See [Routine Updates](#routine-updates) below. Nectar tracks `v0.5` on this repo; the routine pull-and-restart sequence is the same whether you've just shipped a tag or are pulling in a hot-fix.

### 9. Verify the Nectar deployment

Check git state:

```bash
cd /home/ubuntu/src/ldaca_wordflow && \
echo "root branch:      $(git branch --show-current)" && \
echo "root commit:      $(git rev-parse --short HEAD)" && \
echo "backend submodule pointer:" && git submodule status backend && \
echo "backend HEAD:     $(git -C backend rev-parse --short HEAD)" && \
echo "backend version:  $(grep ^version backend/pyproject.toml)"
```

A leading `+` in `git submodule status backend` means the deployed backend checkout does not match the root repo's recorded pointer — the next request will serve stale code. Re-run `git submodule update --init --recursive --checkout --force` to fix.

Check served assets:

```bash
curl -s http://127.0.0.1:8001/ | grep -Eo 'assets/[A-Za-z0-9._-]+' | head -20
```

For UI regressions, also verify the bundled build contains a distinctive string from this release (substitute something unique to what you shipped):

```bash
cd /home/ubuntu/src/ldaca_wordflow/backend
rg -n "<distinctive-feature-string-from-this-release>" src/ldaca_wordflow/resources/frontend/build
```

---

## Deploying a Feature Branch to Nectar

Use this when a feature branch has frontend source changes and needs to be deployed to Nectar **before** a full versioned release (e.g. testing a new auth provider in production). Required whenever `frontend/src/**` changes on a branch, regardless of whether versions are bumped. **No version bump** — just refresh the bundle on the feature branch.

### 1. Rebuild + redeploy the bundle on the feature branch

```bash
cd /path/to/ldaca_wordflow
pnpm deploy_frontend_to_backend
```

### 2. (Optional) Confirm the new feature string is in the bundle

```bash
for f in $(tar -tf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz | grep -E '\.js$'); do
  hits=$(tar -xOf backend/src/ldaca_wordflow/resources/frontend/build.tar.gz "$f" \
         | grep -cE "SomeNewFeatureString")
  if [ "$hits" -gt 0 ]; then echo "$hits hits in $f"; fi
done
```

Zero total hits → the build didn't include your change. Stop and investigate.

### 3. Commit + push the rebuilt bundle on the backend submodule

```bash
cd /path/to/ldaca_wordflow/backend
git add src/ldaca_wordflow/resources/frontend/
git commit -m "build: rebuild frontend bundle with <feature name>"
git push origin <feature-branch>
```

### 4. Bump the root repo's submodule pointer + push

```bash
cd /path/to/ldaca_wordflow
git add backend
git commit -m "build: point backend submodule to rebuilt <feature name> bundle"
git push origin <feature-branch>
```

### 5. Deploy on Nectar

```bash
cd /home/ubuntu/src/ldaca_wordflow
git fetch origin
git checkout <feature-branch>
git pull --ff-only origin <feature-branch>
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-wordflow
```

Once the feature lands in a tagged release, switch Nectar back to `v0.5` (see [Routine Updates](#routine-updates)).

---

## Routine Updates

Pull the latest `v0.5` tip and restart. Same sequence whether you just shipped a tag or are pulling in a hot-fix:

```bash
cd /home/ubuntu/src/ldaca_wordflow
git checkout v0.5                         # in case Nectar is on a feature branch or the legacy dev/v0.4 line
git pull --ff-only origin v0.5
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-wordflow
```

The submodule sync step is mandatory: this repo embeds `ldaca-wordflow-backend` (along with `docworkspace`, `polars-text`, `ldaca-tabulator`) as git submodules, and a plain `git pull` only advances the *submodule pointer* in the parent tree without checking out the new submodule content. Skipping the sync leaves systemd running stale backend code while `git status` looks clean.

If the service still serves stale frontend assets after the restart, confirm the backend submodule matches the root repo's recorded pointer. A leading `+` in `git submodule status backend` means the deployed backend checkout does not match — re-run the update line above.

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

| Symptom | Check |
| --- | --- |
| App not responding | `sudo systemctl status ldaca-wordflow` and `sudo journalctl -u ldaca-wordflow -n 50` |
| 502 Bad Gateway from Nginx | App may be down — restart with `sudo systemctl restart ldaca-wordflow` |
| Certificate expired | `sudo certbot renew` |
| Port 8001 already in use | `sudo fuser -k 8001/tcp` then start the service |
| Old UI served after deploy | Frontend source changed but `build.tar.gz` was not rebuilt — follow [Deploying a Feature Branch to Nectar](#deploying-a-feature-branch-to-nectar) steps 1–4, then redeploy |
| New feature missing from UI | Verify with the bundle-grep snippet under [Deploying a Feature Branch to Nectar](#deploying-a-feature-branch-to-nectar) step 2 — if `0` hits, rebuild and recommit the bundle |
| In-app version doesn't match `pip show` | Forgot to run `pnpm deploy_frontend_to_backend` after `bump-version`. The wheel metadata is correct but the FE bundle's baked-in `VITE_APP_VERSION` is stale. Rebuild, redeploy, and recommit (or, post-tag, re-stamp under a new patch version because PyPI is immutable). |
| `release.yml` fails at `verify-versions` | Version drift across the five sources. Run `pnpm check-versions` locally to see which file is out, then `pnpm bump-version <correct-semver>` to align them. |
