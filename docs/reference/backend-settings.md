# Backend Settings Reference

`ldaca_wordflow.settings.Settings` is the exact configuration authority.
Settings are case-insensitive environment variables whose names match the
fields below in uppercase. Complex tuples use Pydantic's JSON environment
encoding, for example `CORS_ALLOWED_ORIGINS='["https://wordflow.example"]'`.
Unknown settings are rejected.

## Storage And Capacity

| Setting | Meaning |
|---|---|
| `DATA_ROOT` | Canonical process-owned storage root |
| `DATABASE_FILE` | Plain filename for the authentication SQLite database |
| `USER_DATA_FOLDER` | Plain name of the per-user root directory |
| `MAX_FILE_UPLOAD_BYTES` | Per-upload byte limit |
| `MAX_WORKSPACE_ARCHIVE_BYTES` | Compressed import limit |
| `MAX_WORKSPACE_EXPORT_BYTES` | Export expanded/compressed limit |
| `MAX_DEFAULT_REQUEST_BODY_BYTES` | Default non-upload request limit |
| `MAX_PREVIEW_SOURCE_BYTES` | Largest source accepted by preview/ingestion |
| `MAX_NODE_STORAGE_BYTES` | Per-Data-Block durable output limit |
| `MAX_TEXT_RESPONSE_BYTES` | Raw-text response limit |
| `MAX_RESPONSE_SNAPSHOT_BYTES` | Per-response snapshot limit |
| `MAX_CONCURRENT_RESPONSE_SNAPSHOTS` | Snapshot concurrency bound |
| `MAX_RESIDENT_WORKSPACES` | Global resident Workspace bound |
| `MAX_WORKSPACES_PER_USER` | Per-user Workspace bound |
| `MAX_WORKSPACE_NODES` | Per-Workspace Data Block bound |
| `MAX_WORKSPACE_SNAPSHOT_BYTES` | Workspace plan/metadata commit limit |
| `WORKSPACE_IDLE_SECONDS` | Resident Workspace idle eviction time |
| `MAX_USER_STORAGE_BYTES` | Per-user durable byte quota |
| `MAX_USER_FILES` / `MAX_USER_DIRECTORIES` | Per-user entry quotas |
| `MIN_FREE_DISK_BYTES` | Reserved physical free space |
| `MAX_TASK_STORE_BYTES` | Durable Task database size limit |
| `MAX_TASK_STORAGE_BYTES` / `MAX_TASK_STORAGE_FILES` | Per-Task storage limits |
| `MAX_TASK_RECORD_BYTES` | Per-record serialized limit |
| `MAX_ACTIVE_TASKS_GLOBAL` / `MAX_ACTIVE_TASKS_PER_USER` | Task admission bounds |
| `MAX_RETAINED_TASKS_PER_USER` | Retained Task record bound |
| `MAX_CONCURRENT_WORKSPACE_IMPORTS` | Archive import concurrency |
| `MAX_CONCURRENT_ASYNC_TASKS` / `MAX_CONCURRENT_PROCESS_TASKS` | Executor bounds |

## Server And Providers

| Setting | Meaning |
|---|---|
| `SERVER_HOST` / `BACKEND_PORT` | Bind host and positive listening port |
| `LOG_LEVEL` / `LOG_FILE` | Process log level and optional Data Root-relative file |
| `CORS_ALLOWED_ORIGINS` | Exact browser Origin allowlist |
| `TRUSTED_HOSTS` | Exact HTTP Host allowlist |
| `QUOTATION_SERVICE_TIMEOUT` | Remote quotation timeout |
| `QUOTATION_SERVICE_MAX_BATCH_SIZE` | Remote quotation batch ceiling |
| `QUOTATION_REMOTE_ENGINES` | Operator-owned quotation engine allowlist |
| `SAMPLE_DATA_REMOTE_URL` | Verified remote sample catalogue root |

Single-user mode requires a loopback server host. Wildcard CORS and Host values
are invalid. Port zero is accepted only by the desktop launcher before it
constructs final Settings.

## Identity

| Setting | Meaning |
|---|---|
| `MULTI_USER` | Enable hosted multi-user mode |
| `SINGLE_USER_ID`, `SINGLE_USER_NAME`, `SINGLE_USER_EMAIL` | Desktop/local identity |
| `GOOGLE_CLIENT_ID` | Optional hosted Google provider client ID |
| `CILOGON_CLIENT_ID` | CILogon OIDC client ID |
| `CILOGON_CLIENT_SECRET` | CILogon OIDC client secret |
| `CILOGON_ISSUER` | Exact trusted HTTPS issuer origin |
| `CILOGON_REDIRECT_URI` | Exact registered callback URL |
| `SESSION_TTL_HOURS` | Hosted Session lifetime |
| `SESSION_COOKIE_SECURE` | Require HTTPS Session cookie |

Multi-user mode requires Google or the complete CILogon client, secret, and
redirect configuration. `CILOGON_ISSUER` is an origin such as
`https://cilogon.aaf.edu.au`; discovery is derived internally by appending
`/.well-known/openid-configuration`.

## LDaCA Data Portal

| Setting | Meaning |
|---|---|
| `LDACA_ONI_API_BASE_URL` | Oni API base URL |
| `LDACA_ONI_API_TOKEN` | Optional portal bearer credential, used only by the provider adapter |
| `LDACA_ONI_TIMEOUT` | Request timeout |
| `LDACA_ONI_DOWNLOAD_CONCURRENCY` | Import download concurrency |
| `LDACA_ONI_FEATURED_COLLECTION_IDS` | Featured collection identifiers |

These provider credentials do not alter Wordflow's own Session transport.
