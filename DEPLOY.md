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
cd /home/ubuntu/src/ldaca_web_app
git pull
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
```

> The `git submodule update --init --recursive` step is mandatory: this
> repo embeds the `ldaca_web_app_backend` package (along with
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

The service file is located at `/etc/systemd/system/ldaca-web-app.service`.
To install it from scratch:

```bash
sudo cp /home/ubuntu/ldaca-web-app.service /etc/systemd/system/ldaca-web-app.service
sudo systemctl daemon-reload
sudo systemctl enable ldaca-web-app
sudo systemctl start ldaca-web-app
```

The service file content:

```ini
[Unit]
Description=LDaCA Text Analytics Web Application
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/src/ldaca_web_app/backend
Environment="MULTI_USER=true"
Environment="CILOGON_CLIENT_ID=cilogon:/client_id/3f6c0af973d3cc270a404823d3bbf122"
Environment="CILOGON_CLIENT_SECRET=_ooOmovo-g0vTwtVSziDNBuT0_mWjCmNTWN1SgeeukMQsdHUWvfHDxcJag2kb2cvJyGLV7l6ZjC--GUw-ftb2g"
Environment="CILOGON_DISCOVERY_URL=https://test.cilogon.aaf.edu.au/.well-known/openid-configuration"
Environment="CILOGON_REDIRECT_URI=https://analytics.ldaca.edu.au/api/auth/cilogon/callback"
ExecStartPre=/bin/rm -rf /home/ubuntu/src/ldaca_web_app/backend/src/ldaca_web_app/resources/frontend/build
ExecStartPre=/bin/tar -xzf /home/ubuntu/src/ldaca_web_app/backend/src/ldaca_web_app/resources/frontend/build.tar.gz -C /home/ubuntu/src/ldaca_web_app/backend/src/ldaca_web_app/resources/frontend
ExecStart=/home/ubuntu/.local/bin/uv run ldaca-web-app --port 8001
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
sudo systemctl status ldaca-web-app

# Start / stop / restart
sudo systemctl start ldaca-web-app
sudo systemctl stop ldaca-web-app
sudo systemctl restart ldaca-web-app

# View live logs
sudo journalctl -u ldaca-web-app -f

# View recent logs (last 100 lines)
sudo journalctl -u ldaca-web-app -n 100 --no-pager
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

> **Critical ordering rule:** All version strings that appear in the UI or in metadata files
> **must be updated before the frontend is built**. The version text in
> `frontend/public/references/general.md` is baked into `build.tar.gz` at build time —
> updating it after the build has no effect on what Nectar or uvx users actually see.

### 1. Bump all version strings (do this first, before any build)

Update the version number in every location below before touching anything else:

| File | What to change |
|---|---|
| `frontend/public/references/general.md` | Last line: `Version X.Y.Z - released on DD/Mon/YYYY.` |
| `frontend/package.json` | `"version": "X.Y.Z"` |
| `frontend/src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` — controls desktop bundle filenames (DMG/MSI) |
| `frontend/src-tauri/Cargo.toml` | `version = "X.Y.Z"` — Rust crate metadata |
| `backend/pyproject.toml` | `version = "X.Y.Z"` |
| `frontend/.env` | `VITE_DOCS_BASE_URL=https://australian-text-analytics-platform.github.io/ldaca-analytics-docs/vX.Y` — **minor version only** (e.g. `v0.4`), not patch |

> **Why `frontend/.env` is committed:** it contains only the public docs base URL — no
> secrets. It is tracked so that both the local `npm run build` (step 2) and the Tauri
> GitHub Actions build pick up the correct docs version automatically via `git checkout`.
> Secrets and local overrides belong in `frontend/.env.local`, which remains gitignored.
> If the minor version hasn't changed (patch release), this file does not need updating.

Then refresh the backend lockfile:

```bash
cd /path/to/ldaca_web_app/backend
uv lock
```

### 2. Build the frontend from the root repo

```bash
cd /path/to/ldaca_web_app
npm run build -w frontend
```

### 3. Sync the built frontend into the backend package bundle

```bash
cd /path/to/ldaca_web_app
node scripts/deploy-frontend-to-backend.mjs
```

This refreshes:

- `backend/src/ldaca_web_app/resources/frontend/build.tar.gz`
- `backend/src/ldaca_web_app/resources/frontend/build/`

**Verify the version string was baked in correctly before proceeding:**

```bash
tar -xOf backend/src/ldaca_web_app/resources/frontend/build.tar.gz \
    build/references/general.md | tail -3
```

The output must show `Version X.Y.Z`. If it still shows the previous version, the build ran
before the version strings were updated — delete the build output and repeat steps 1–3.

**Verify any new feature strings are present in the bundle:**

```bash
tar -xOf backend/src/ldaca_web_app/resources/frontend/build.tar.gz \
    $(tar -tf backend/src/ldaca_web_app/resources/frontend/build.tar.gz \
      | grep 'assets/index.*\.js' | head -1) \
  | grep -c "SomeNewFeatureString"
```

Replace `SomeNewFeatureString` with a distinctive identifier from the new feature (e.g. a
button label, component name, or route). A count of `0` means the source change was not
included in the build — do not proceed.

### 4. Validate the backend release artifact

```bash
cd /path/to/ldaca_web_app/backend
uv build
uv run pytest -q
uvx ty check
uvx --from dist/ldaca_web_app-<VERSION>-py3-none-any.whl ldaca-web-app --help
```

If `uvx ty check` is already failing on unrelated, pre-existing issues, record that explicitly before releasing.

### 5. Publish the backend package repo

From the `backend/` repo:

```bash
cd /path/to/ldaca_web_app/backend
git add pyproject.toml uv.lock src/ldaca_web_app/resources/frontend/build.tar.gz
git commit -m "Release v<VERSION>"
git push origin main
git tag v<VERSION>
git push origin v<VERSION>
```

This triggers the backend repo's PyPI publish workflow.

### 6. Update the root repo to the new backend submodule pointer

From the root repo:

```bash
cd /path/to/ldaca_web_app
git add backend frontend/package.json frontend/public/references/general.md \
    frontend/src-tauri/tauri.conf.json frontend/src-tauri/Cargo.toml
git commit -m "Release v<VERSION>: bump versions and sync backend submodule"
git push origin dev
```

### 7. Verify the published `uvx` package

After the backend release workflow finishes:

```bash
uvx --refresh ldaca-web-app@<VERSION> --help
uvx --from ldaca-web-app==<VERSION> ldaca-web-app --help
```

For a full smoke test:

```bash
uvx --from ldaca-web-app==<VERSION> ldaca-web-app --host 127.0.0.1 --port 8016
```

### 8. Merge `dev` into `main` in the root repo

```bash
cd /path/to/ldaca_web_app
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
cd /home/ubuntu/src/ldaca_web_app
git pull
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-web-app
```

### 10. Verify the Nectar deployment

Check git state:

```bash
cd /home/ubuntu/src/ldaca_web_app && \
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
cd /home/ubuntu/src/ldaca_web_app/backend
rg -n "Reset all hints|Topic Modelling - BERTopic|All hints have been reset" src/ldaca_web_app/resources/frontend/build
```

---

## Deploying a Feature Branch to Nectar

Use this when a feature branch has frontend source changes and needs to be deployed to
Nectar **before** a full versioned release (e.g. testing a new auth provider in
production). These steps are required whenever `frontend/src/**` changes on a branch,
regardless of whether versions are bumped.

### 1. Rebuild the frontend bundle on the feature branch

```bash
cd /path/to/ldaca_web_app
npm run build -w frontend
node scripts/deploy-frontend-to-backend.mjs
```

### 2. Verify the new feature is in the bundle

```bash
tar -xOf backend/src/ldaca_web_app/resources/frontend/build.tar.gz \
    $(tar -tf backend/src/ldaca_web_app/resources/frontend/build.tar.gz \
      | grep 'assets/index.*\.js' | head -1) \
  | grep -c "SomeNewFeatureString"
```

A count of `0` means the build did not include your change — stop and investigate.

### 3. Commit the updated bundle to the backend submodule branch

```bash
cd /path/to/ldaca_web_app/backend
git add src/ldaca_web_app/resources/frontend/build.tar.gz
git commit -m "build: rebuild frontend bundle with <feature name>"
git push origin <feature-branch>
```

### 4. Update the root repo submodule pointer

```bash
cd /path/to/ldaca_web_app
git add backend
git commit -m "build: point backend submodule to rebuilt <feature name> bundle"
git push origin <feature-branch>
```

### 5. Deploy to Nectar

```bash
cd /home/ubuntu/src/ldaca_web_app
git fetch origin
git checkout <feature-branch>
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-web-app
```

---

## Updating the App

```bash
cd /home/ubuntu/src/ldaca_web_app
git pull
git submodule sync --recursive
git submodule update --init --recursive --checkout --force
sudo systemctl restart ldaca-web-app
```

If the service still serves stale frontend assets after a restart, confirm the backend submodule matches the root repo's recorded commit. A leading `+` in `git submodule status backend` means the deployed backend checkout does not match the root repo pointer.

---

## Changing Configuration

If you need to update environment variables (e.g. `GOOGLE_CLIENT_ID`) or startup flags:

1. Edit the service file:

   ```bash
   sudo nano /etc/systemd/system/ldaca-web-app.service
   ```

2. Reload systemd and restart the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart ldaca-web-app
   ```

---

## Troubleshooting

| Symptom                        | Check                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| App not responding             | `sudo systemctl status ldaca-web-app` and `sudo journalctl -u ldaca-web-app -n 50` |
| 502 Bad Gateway from Nginx     | App may be down — restart with `sudo systemctl restart ldaca-web-app`              |
| Certificate expired            | `sudo certbot renew`                                                               |
| Port 8001 already in use       | `sudo fuser -k 8001/tcp` then start the service                                    |
| Old UI served after deploy     | Frontend source changed but `build.tar.gz` was not rebuilt — follow [Deploying a feature branch to Nectar](#deploying-a-feature-branch-to-nectar) steps 1–4, then redeploy |
| New feature missing from UI    | Verify with `grep -c "FeatureString"` against the bundle (see release step 3) — if `0`, rebuild and recommit `build.tar.gz` |
