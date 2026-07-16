# Hosted Deployment Runbook

This runbook covers the same-site hosted deployment behind an HTTPS reverse
proxy. Replace hostnames, paths, and release refs with the deployment's actual
values.

## Prepare The Checkout

```bash
git clone https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow.git
cd ldaca-wordflow
git checkout <release-ref>
git submodule sync --recursive
git submodule update --init --recursive --checkout
pnpm install --frozen-lockfile
pnpm deploy_frontend_to_backend
uv sync --project backend --frozen --no-dev --no-editable
```

The current submodules are `backend`, `polars-text`, and
`polars-source-utils`. A pull that advances a submodule pointer must be followed
by the sync/update commands before restart.

## Backend Environment

Store non-secret settings in the service definition and provider secrets in a
mode-`0600` environment file owned by the service account. A hosted CILogon
profile requires:

```ini
MULTI_USER=true
SERVER_HOST=127.0.0.1
BACKEND_PORT=8001
TRUSTED_HOSTS=["analytics.ldaca.edu.au"]
CORS_ALLOWED_ORIGINS=["https://analytics.ldaca.edu.au"]
CILOGON_CLIENT_ID=<registered-client-id>
CILOGON_ISSUER=https://cilogon.aaf.edu.au
CILOGON_REDIRECT_URI=https://analytics.ldaca.edu.au/api/auth/cilogon/callback
SESSION_COOKIE_SECURE=true
```

The secret file supplies only `CILOGON_CLIENT_SECRET`. See
[CILogon secrets](cilogon-secrets.md).

## systemd

The preparation command builds the backend and sibling sources into the
backend-owned environment without editable checkout links. Run that prepared
entry point directly:

```ini
[Unit]
Description=LDaCA Wordflow
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wordflow
WorkingDirectory=/srv/ldaca-wordflow/backend
EnvironmentFile=/etc/ldaca-wordflow/app.env
EnvironmentFile=/etc/ldaca-wordflow/secrets.env
ExecStart=/srv/ldaca-wordflow/backend/.venv/bin/ldaca-wordflow --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Run one service process. Do not add Uvicorn workers; see
[ADR 0001](../adr/0001-single-process-lifespan-owned-backend.md).

## Reverse Proxy And Readiness

Terminate TLS at the reverse proxy, preserve the original Host and scheme, use
long read timeouts for SSE, and disable buffering for `/api/events`.
Forward to `127.0.0.1:8001` and verify:

```bash
curl --fail --silent https://analytics.ldaca.edu.au/health
```

The response must report `status: ready` and the intended package version.

## Update

```bash
git fetch --tags origin
git checkout <release-ref>
git pull --ff-only
git submodule sync --recursive
git submodule update --init --recursive --checkout
pnpm install --frozen-lockfile
pnpm deploy_frontend_to_backend
uv sync --project backend --frozen --no-dev --no-editable
sudo systemctl restart ldaca-wordflow
curl --fail --silent https://analytics.ldaca.edu.au/health
```

If startup fails, inspect `journalctl -u ldaca-wordflow` before changing files
or deleting Data Root state.
