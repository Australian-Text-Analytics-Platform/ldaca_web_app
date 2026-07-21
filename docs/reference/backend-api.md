# Backend API Reference

This is the canonical human-readable HTTP inventory for the current backend.
Generated OpenAPI and
`backend/tests/unit/test_current_api_surface.py` enforce the executable method,
path, and operation-ID set. All `/api` operations use the identity dependency
unless marked public. Unsafe operations also require exact Origin and CSRF
proof, except provider callbacks with their own one-use validation.

## Session, Providers, Storage, And Events

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/session` | `get_session` | 200 | Public optional-cookie bootstrap, identity, providers, and CSRF token |
| `DELETE /api/session` | `delete_session` | 204 | Revoke exactly the presented hosted Session |
| `POST /api/auth/google/callback` | `google_callback` | 303 | Public Google credential callback |
| `GET /api/auth/cilogon/login` | `cilogon_login` | 302 | Public CILogon authorization redirect |
| `GET /api/auth/cilogon/callback` | `cilogon_callback` | 303 | Public CILogon OIDC callback |
| `POST /api/annotation-providers/{provider}/models` | `list_annotation_models` | 200 | Resolve provider model IDs with an optional write-only request key |
| `GET /api/preferences` | `get_preferences` | 200 | Read synchronized non-secret current-principal preferences |
| `PATCH /api/preferences` | `update_preferences` | 200 | Partially update synchronized current-principal preferences |
| `GET /api/provider-credentials` | `get_provider_credentials` | 200 | Read configured-provider status without returning secrets |
| `PATCH /api/provider-credentials` | `update_provider_credentials` | 200 | Update single-user root Provider Credentials |
| `DELETE /api/provider-credentials` | `clear_provider_credentials` | 204 | Clear all single-user root Provider Credentials |
| `GET /api/tokenizer-models` | `list_tokenizer_models` | 200 | List backend-supported tokenizer models |
| `GET /api/storage` | `get_storage` | 200 | Fresh current-principal allocated-byte quota status |
| `GET /api/events` | `backend_events` | 200 SSE | Unified bounded resource-refresh stream |

`UserPreferences` has exactly `hidden_views`, `favorite_workspaces`,
`default_tokenizer_model`, `analysis_multi_tab_enabled`, and
`contextual_hints_enabled`. `PATCH` changes only fields present in the request;
an explicit `null` clears `default_tokenizer_model`. Unknown fields and invalid
nulls are rejected. Provider credential responses never include secret values.

`GET /api/provider-credentials` reports `storage: backend` plus configured
presence in single-user mode. In multi-user mode it reports `storage: browser`,
does not claim knowledge of personal credential presence, and still reports
whether a deployment Data Portal token is available. `PATCH` and `DELETE` are
single-user-only; multi-user attempts return `403 access_denied`.

Annotation model, preview, and root Analysis submission bodies accept an
optional write-only `api_key`. Single-user mode rejects request keys and
resolves the root credential file. Multi-user mode requires the request key.
Any missing resolved Annotation credential returns
`409 provider_credential_missing`. The submission field is removed before an
`AnnotationAnalysisRequest` is persisted.

## User Files And External Data

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/user-files` | `list_user_files` | 200 | Complete deterministic User File tree |
| `GET /api/user-files/resource` | `get_user_file_resource` | 200 | Address one file or directory |
| `PATCH /api/user-files` | `move_file` | 200 | Move without replacement |
| `DELETE /api/user-files` | `delete_file` | 204 | Delete a file or directory |
| `POST /api/user-files/folders` | `create_folder` | 201 | Create an addressable folder |
| `POST /api/user-files/uploads` | `upload_file` | 201 | Stream and atomically publish a file |
| `GET /api/user-files/raw` | `get_raw_file` | 200 | Bounded UTF-8 text read |
| `GET /api/user-files/content` | `download_file` | 200 | Binary response-snapshot download |
| `GET /api/user-files/preview` | `preview_file` | 200 Arrow | One bounded file row page |
| `GET /api/user-files/preview/schema` | `preview_file_schema` | 200 Arrow | Zero-row file schema stream |
| `GET /api/user-files/worksheets` | `list_file_worksheets` | 200 | Excel worksheet names |
| `GET /api/sample-collections` | `list_sample_collections` | 200 | Validated remote sample catalogue |
| `POST /api/sample-collections/{collection_id}/imports` | `submit_sample_import` | 202 | Create and queue a retained sample User File Import |
| `POST /api/data-portal/search` | `search_data_portal` | 200 | Search Oni with an optional write-only request token |
| `POST /api/data-portal/featured` | `list_featured_data_portal_collections` | 200 | Read featured collections with an optional write-only request token |
| `POST /api/data-portal/imports` | `submit_data_portal_import` | 202 | Create and queue a retained portal User File Import using an optional write-only request token |

Data Portal request bodies accept optional write-only `api_token`. A supplied
token is used for that call; otherwise the deployment token is used. The token
is removed before a User File Import request is retained.

## User File Imports

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/user-file-imports` | `list_user_file_imports` | 200 | Paginated retained import history |
| `GET /api/user-file-imports/{import_id}` | `get_user_file_import` | 200 | Read one owned import |
| `POST /api/user-file-imports/{import_id}/cancel` | `cancel_user_file_import` | 200/202 | Cancel queued work or request running cancellation |
| `DELETE /api/user-file-imports/{import_id}` | `delete_user_file_import` | 204 | Delete terminal history without deleting published files |

## Workspaces And Archives

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces` | `list_workspaces` | 200 | Fresh owner-filtered filesystem catalogue |
| `POST /api/workspaces` | `create_workspace` | 201 | Create one closed Revision-1 Workspace |
| `POST /api/workspaces/imports` | `import_workspace_archive` | 201 | Validate, re-identify, and atomically install an archive |
| `GET /api/workspaces/{workspace_id}` | `get_workspace_by_id` | 200 | Read lightweight metadata and runtime state |
| `PATCH /api/workspaces/{workspace_id}` | `update_workspace_by_id` | 200 | Update metadata on an open Workspace |
| `DELETE /api/workspaces/{workspace_id}` | `delete_workspace_by_id` | 204 | Stop owned execution and atomically remove the Workspace |
| `PUT /api/workspaces/{workspace_id}/open` | `open_workspace_by_id` | 200 | Idempotently load the Workspace aggregate |
| `DELETE /api/workspaces/{workspace_id}/open` | `close_workspace_by_id` | 204/202 | Close now or enter closing state until Analysis work drains |
| `GET /api/workspaces/{workspace_id}/archive` | `export_workspace_archive` | 200 ZIP | Snapshot and export portable Workspace content |
| `POST /api/workspaces/{workspace_id}/sql` | `execute_workspace_sql` | 200 Arrow / 201 JSON | Query declared Data Blocks or create a SQL-derived Data Block |

Workspace SQL query mode accepts unique `node_ids`, nonblank `sql`, and
one-based `page` and `page_size` (default 50, maximum 500). It returns a
self-contained Arrow stream with `ETag`, `Cache-Control: no-store`, and
`X-Wordflow-Has-Next`. Create mode accepts the same declared inputs and SQL
plus a required Data Block `name`, and returns the created resource with
`Location` and `ETag`. Data Blocks are bound by exact UUID and must be quoted
as SQL identifiers. External `read_*` and `scan_*` functions are rejected.

## Data Blocks

The API uses `nodes` for the backend representation of Data Blocks. All routes
below require the Workspace to be open.

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces/{workspace_id}/nodes` | `list_nodes` | 200 | Complete ordered Data Block collection |
| `POST /api/workspaces/{workspace_id}/nodes` | `create_node` | 201 | Create a source or typed derived Data Block |
| `POST /api/workspaces/{workspace_id}/nodes/previews` | `preview_node_creation` | 200 Arrow | Side-effect-free derived Data Block row page |
| `PUT /api/workspaces/{workspace_id}/nodes/order` | `reorder_workspace_nodes_by_id` | 200 | Persist the complete Data Block order |
| `GET /api/workspaces/{workspace_id}/nodes/{node_id}` | `get_node` | 200 | Read complete Data Block metadata |
| `PATCH /api/workspaces/{workspace_id}/nodes/{node_id}` | `update_node` | 200 | Update Data Block name, document column, or color metadata |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/edits` | `edit_node` | 200 | Replace the selected Data Block plan with a typed identity-preserving edit |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/undo` | `undo_node` | 200 | Restore the previous plan from this open Workspace session |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/redo` | `redo_node` | 200 | Restore the next plan from this open Workspace session |
| `DELETE /api/workspaces/{workspace_id}/nodes/{node_id}` | `delete_node` | 204 | Delete while preserving graph integrity |
| `GET /api/workspaces/{workspace_id}/nodes/{node_id}/schema` | `get_node_schema` | 200 Arrow | Authoritative zero-row Data Block schema stream |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/annotation-previews` | `preview_annotation` | 200 | Stateless bounded provider preview |

`NodeEditRequest` accepts `cast`, `rename_column`, `delete_column`, `filter`,
`replace`, or `expression`. Sample, Join, and Stack remain creation-only, and
cast is not part of the creation request union. Every `WorkspaceNodeInfo`
contains required `can_undo` and `can_redo` flags. Only the current plan is
durable; both flags reset after load, clone, import, close/reopen, or backend
restart.

## Tabs

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces/{workspace_id}/tabs` | `list_tabs` | 200 | Complete ordered Tab collection |
| `POST /api/workspaces/{workspace_id}/tabs` | `create_tab` | 201 | Create one named fixed-kind Tab |
| `GET /api/workspaces/{workspace_id}/tabs/{tab_id}` | `get_tab` | 200 | Read one Tab |
| `PATCH /api/workspaces/{workspace_id}/tabs/{tab_id}` | `rename_tab` | 200 | Rename one Tab |
| `DELETE /api/workspaces/{workspace_id}/tabs/{tab_id}` | `delete_tab` | 204 | Delete an empty Tab |
| `GET /api/workspaces/{workspace_id}/tabs/{tab_id}/analysis` | `get_tab_analysis` | 200 | Read the Tab's current root Analysis |
| `POST /api/workspaces/{workspace_id}/tabs/{tab_id}/analysis` | `submit_tab_analysis` | 201 | Create and queue the Tab's one root Analysis |
| `DELETE /api/workspaces/{workspace_id}/tabs/{tab_id}/analysis` | `clear_tab_analysis` | 204 | Detach and privately clean the current Analysis tree |

## Analyses

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces/{workspace_id}/analyses` | `list_analyses` | 200 | Paginated live root and Child Analyses |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}` | `get_analysis` | 200 | Read one live valid Analysis |
| `POST /api/workspaces/{workspace_id}/analyses/{analysis_id}/children` | `submit_child_analysis` | 201 | Create a typed Concordance, Quotation, or Topic Modeling direct Child Analysis |
| `POST /api/workspaces/{workspace_id}/analyses/{analysis_id}/cancel` | `cancel_analysis` | 200/202 | Cancel queued work or request running cancellation |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result` | `get_analysis_result` | 200 | Typed default Result projection |
| `POST /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query` | `query_analysis_result` | 200 | Typed side-effect-free alternate projection |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}` | `download_analysis_table` | 200 Arrow | Complete immutable Result table |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/rows` | `get_analysis_table_rows` | 200 Arrow | Independent page from an open-ended Result table |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/schema` | `get_analysis_table_schema` | 200 Arrow | Zero-row open-ended Result table schema |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/artifacts/{artifact_name}` | `download_analysis_artifact` | 200 | Download a declared Analysis Artifact snapshot |

Every valid Analysis resource includes required ordered `output_node_ids`.
The list is empty until a publishing Analysis succeeds. Existing single-output
operations return one ID; Topic Modeling detachment returns topic-data then
topic-meanings IDs for each source in request order. The removed singular field
is not accepted.

## Readiness And Common Semantics

`GET /health` (`health_check`) is public. It returns `200` with `status: ready`
or `503` with `status: stopping`, plus the installed package version.

- Addressable creation returns `201` and relative `Location`; accepted import
  submission or running cancellation returns `202`; empty deletion returns
  `204`.
- A Workspace content commit advances its server-ordered Revision and returns a
  strong `ETag`. Clients do not submit `If-Match`.
- A Result before Analysis success is `409 analysis_not_succeeded`; a missing
  successful Artifact is `410 artifact_gone`.
- Cross-user resources are concealed as `404`.
- Validation uses sanitized `422 ApiError` responses with `X-Request-ID`.
- Analysis, Workspace SQL, Arrow row-page, and User File Import pagination is one-based and rejects zero.
  Workspace, Tab, Data Block, and User File collections return complete
  deterministic lists; User File tree size is guarded by a response-byte limit.
- Arrow row pages, including Workspace SQL query pages, use one-row lookahead
  and `X-Wordflow-Has-Next`; they do not
  calculate or return total row/page counts. Complete Result tables use one
  self-contained stream. JSON is not a fallback representation for tables.
- `/api/events` carries monotonic process-local sequence numbers and resource
  refresh signals. It offers no historical `Last-Event-ID` replay.
