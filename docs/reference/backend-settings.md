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
| `MAX_FILE_UPLOAD_BYTES` | Per-upload byte limit |
| `MAX_WORKSPACE_ARCHIVE_BYTES` | Compressed import limit |
| `MAX_WORKSPACE_EXPORT_BYTES` | Export expanded/compressed limit |
| `MAX_DEFAULT_REQUEST_BODY_BYTES` | Default non-upload request limit |
| `MAX_PREVIEW_SOURCE_BYTES` | Largest source accepted by preview/ingestion |
| `MAX_NODE_STORAGE_BYTES` | Per-Data-Block durable output limit |
| `MAX_TEXT_RESPONSE_BYTES` | Raw-text response limit |
| `MAX_USER_FILE_TREE_RESPONSE_BYTES` | Complete serialized User File tree response limit |
| `MAX_RESPONSE_SNAPSHOT_BYTES` | Per-response snapshot limit |
| `MAX_CONCURRENT_RESPONSE_SNAPSHOTS` | Snapshot concurrency bound |
| `MAX_OPEN_WORKSPACE_BYTES` | Hosted process capacity for serialized open Workspace state |
| `MAX_WORKSPACE_NODES` | Per-Workspace Data Block bound |
| `MAX_WORKSPACE_SNAPSHOT_BYTES` | Workspace plan/metadata commit limit |
| `MIN_FREE_DISK_BYTES` | Reserved physical free space |
| `ANALYSIS_EXECUTION_CAPACITY` | Concurrent fresh Analysis child processes; saturation queues |
| `USER_FILE_IMPORT_CAPACITY` | Concurrent complete User File Imports on the independent scheduler |
| `SHUTDOWN_GRACE_SECONDS` | Shared positive finite Analysis/import termination deadline |
| `MAX_ANALYSIS_STORAGE_BYTES` / `MAX_ANALYSIS_STORAGE_FILES` | Private snapshot, output, and Artifact bounds per Analysis |
| `MAX_USER_FILE_IMPORT_BYTES` / `MAX_USER_FILE_IMPORT_FILES` | Staged output bounds per User File Import |
| `MAX_USER_FILE_IMPORT_RECORD_BYTES` | Strict per-import JSON record limit |
| `MAX_CONCURRENT_WORKSPACE_IMPORTS` | Archive import concurrency |

The internal layout is fixed rather than configurable:
`deployment.sqlite3`, `workspaces/`, and `users/` are direct children of the
Data Root. There is no Workspace-count setting or alternate per-user Workspace
directory. Explicitly open Workspaces remain open until close, deletion, or
shutdown; there is no idle or LRU setting. `MAX_OPEN_WORKSPACE_BYTES` applies
only in hosted multi-user mode, while single-user mode has no process-residency
cap. Per-principal quota is the nullable `users.storage_quota_bytes`
policy in `deployment.sqlite3`, not an environment setting. `NULL` means
unlimited; new hosted users receive the database default of 30 GiB. There are
no file-count, directory-count, Analysis-count, or queue-count quotas.

Both execution capacities default to two and accept any positive integer with
no schema ceiling or unlimited sentinel. `SHUTDOWN_GRACE_SECONDS` defaults to
10 seconds and must be positive and finite. All three are immutable for one
runtime and change only after restart.

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
