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

The backend is tracked directly in the root repository. The current submodules
are `polars-text`, `polars-source-utils`, `ldaca-analytics-sample-data`, and the
published documentation mirror. A pull that advances one of those pointers
must be followed by the sync/update commands before restart. The backend
fetches sample data from the repository's published raw GitHub URLs at runtime;
it does not read the sample-data submodule checkout.

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

## Provider Credentials

Do not place users' Annotation or Data Portal credentials in the service
environment or backend Data Root. In multi-user mode, each user enters personal
credentials under **Settings → AI** or **Settings → Portal**. Wordflow
stores the ordered, named Annotation configuration collection and its secrets
only in that browser's `wordflow-provider-credentials` version 2 localStorage
entry, partitioned by authenticated user ID, and sends the selected secret
transiently with provider calls. Logout deliberately retains the browser entry;
a different browser profile or device requires re-entry.

`LDACA_ONI_API_TOKEN` is an optional deployment-wide Data Portal fallback and
may be supplied through the service secret file. It is not a personal
credential and does not replace the browser-owned Annotation keys required in
multi-user mode.

Authenticated hosted users may configure a Custom OpenAI-compatible absolute
HTTP(S) base URL, including private or loopback destinations. The backend makes
model-list and Chat Completions requests to that user-selected destination.
Deploy only where this deliberate trusted-user SSRF boundary is acceptable.

After upgrading from server-stored multi-user credentials, existing
`users/*/provider-credentials.toml` files remain untouched but are never read.
Have users re-enter their keys, then remove legacy files manually according to
the deployment's backup and retention policy. Do not automate that deletion as
part of startup or upgrade.

Browser localStorage removes backend at-rest custody; it does not protect a
credential from same-origin script injection or a privileged browser
extension. Treat CSP and XSS hardening as an independent hosted security
control and follow-up.

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
