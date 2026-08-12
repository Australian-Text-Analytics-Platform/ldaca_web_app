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
| `POST /api/annotation-providers/models` | `list_annotation_models` | 200 | Attempt model discovery for one safe provider-configuration snapshot and optional write-only request key |
| `GET /api/preferences` | `get_preferences` | 200 | Read synchronized non-secret current-principal preferences |
| `PATCH /api/preferences` | `update_preferences` | 200 | Partially update synchronized current-principal preferences |
| `GET /api/provider-credentials` | `get_provider_credentials` | 200 | Read safe provider-configuration metadata and Data Portal status without returning secrets |
| `PATCH /api/provider-credentials` | `update_data_portal_credential` | 200 | Update the single-user root Data Portal credential |
| `DELETE /api/provider-credentials` | `clear_provider_credentials` | 204 | Clear all single-user root Provider Credentials |
| `POST /api/provider-credentials/annotation-providers` | `create_annotation_provider_configuration` | 201 | Create one single-user Annotation Provider Configuration |
| `DELETE /api/provider-credentials/annotation-providers` | `clear_annotation_provider_configurations` | 204 | Clear all single-user Annotation Provider Configurations |
| `PATCH /api/provider-credentials/annotation-providers/{configuration_id}` | `rename_annotation_provider_configuration` | 200 | Rename one single-user Annotation Provider Configuration |
| `DELETE /api/provider-credentials/annotation-providers/{configuration_id}` | `delete_annotation_provider_configuration` | 204 | Delete one single-user Annotation Provider Configuration |
| `GET /api/tokenizer-models` | `list_tokenizer_models` | 200 | List backend-supported tokenizer models |
| `GET /api/storage` | `get_storage` | 200 | Fresh current-principal allocated-byte quota status |
| `GET /api/events` | `backend_events` | 200 SSE | Unified bounded resource-refresh stream |

`UserPreferences` has exactly `hidden_views`, `favorite_workspaces`,
`analysis_multi_tab_enabled`, and `contextual_hints_enabled`. `PATCH` changes
only fields present in the request. Unknown fields and invalid nulls are
rejected. The durable `preferences.toml` schema is version 2; earlier schemas
are rejected. Provider credential responses never include secret values.

`GET /api/provider-credentials` reports `storage: backend`, the ordered safe
`annotation_providers` collection, and Data Portal presence in single-user
mode. Each configuration exposes only UUID, duplicate-allowed name, provider
type, optional normalized Custom base URL, and key presence. In multi-user mode
it reports `storage: browser`, returns `annotation_providers: null`, and still
reports whether a deployment Data Portal token is available. Every credential
write is single-user-only; multi-user attempts return `403 access_denied`.

Annotation model discovery and root Analysis submission bodies accept an
immutable safe snapshot: `provider_configuration_id`, provider type, and an
optional normalized Custom base URL. They also accept an optional write-only
`api_key`. Single-user mode rejects request keys, verifies the snapshot against
the root credential file, and resolves the stored key. Multi-user mode requires
a request key for built-ins; Custom configurations may be keyless. A missing
required credential returns `409 provider_credential_missing`. The key is
removed before an `AnnotationAnalysisRequest` is persisted. Display names are
never part of the request.

Built-in configuration identity is provider type plus API key. Custom identity
is normalized base URL plus key-or-absence. Duplicate identities return a
conflict, while duplicate names are valid. Only names can change in place.
Custom bases must be absolute HTTP(S) URLs with a host and no user information,
query, or fragment. Public, private, loopback, `localhost`, and `127.0.0.1`
destinations are deliberately accepted for trusted authenticated users.

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

`FileResource.loadable` is required for every resource. It is `false` for
directories and for files outside the canonical case-insensitive allowlist.
The User File collection remains complete; `loadable` is a consumer signal,
not a storage or upload filter. `file_type` remains `unknown` for unsupported
files.

File preview reports the preview loader's own schema. Delimited previews
(`.csv` and `.tsv`) expose raw String fields and preserve source lexemes;
JSON-family previews use full-file type inference. Creating a Source Data Block
performs full-file inference for every row-oriented format before Parquet
staging, so its authoritative schema may intentionally differ from a delimited
preview. Parser failures encountered while producing either a preview page or
schema return `400 invalid_input`.

Loadable filename extensions are:

- delimited: `.csv`, `.tsv`;
- JSON: `.json`, `.jsonl`, `.ndjson`;
- columnar: `.parquet`, `.avro`, `.arrow`, `.ipc`, `.feather`;
- spreadsheets: `.xlsx`, `.xls`, `.xlsm`, `.xlsb`, `.ods`;
- strict UTF-8 text: `.txt`, `.text`, `.md`, `.rst`, `.log`;
- UTF-8 document archives: `.zip`.

ZIP ingestion returns one deterministic path-ordered row per decodable regular
member with string columns `file_path`, `base_name`, `extension`, and
`document`. Directories, macOS metadata, and members that fail strict UTF-8
decoding are omitted. A safe archive with no readable members returns the same
typed schema with zero rows.

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
| `GET /api/workspaces` | `list_workspaces` | 200 | Fresh owner-filtered available/unavailable filesystem catalogue |
| `POST /api/workspaces` | `create_workspace` | 201 | Create one closed Revision-1 Workspace |
| `POST /api/workspaces/imports` | `import_workspace_archive` | 201 | Validate, re-identify, and atomically install an archive |
| `GET /api/workspaces/{workspace_id}` | `get_workspace_by_id` | 200 | Read lightweight metadata and runtime state |
| `PATCH /api/workspaces/{workspace_id}` | `update_workspace_by_id` | 200 | Update metadata on an open Workspace |
| `DELETE /api/workspaces/{workspace_id}` | `delete_workspace_by_id` | 204 | Stop owned execution and atomically remove the Workspace |
| `PUT /api/workspaces/{workspace_id}/open` | `open_workspace_by_id` | 200 | Validate and make this the user's sole open Workspace |
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

Open, close, and delete lifecycle commands are serialized per user. Opening a
Workspace closes idle open siblings and marks busy siblings `closing`; multiple
closing resources are allowed, but multiple open resources are not. Reopening a
closing target makes it the sole open resource. If opening fails after a sibling
transition, the response reports the real error and subsequent collection reads
expose the resulting backend state.

`GET /api/workspaces` returns a discriminated `WorkspaceListItem` collection.
An `available` item contains every `WorkspaceResource` field. An `unavailable`
item contains only `availability`, canonical `id`, safe `message`, and `reason`:
`incompatible_format`, `corrupt_snapshot`, or `configured_limit`. Incompatible
items also contain `stored_schema_version` and `supported_schema_version`;
other reasons return those fields as null. Create, direct read, open, update,
and import continue to return strict `WorkspaceResource` responses. Delete
continues to authorize from the canonical directory and ownership sidecar.

Native Workspace snapshots use schema version 16 and portable archives use
format version 15. Readers accept only those exact versions; import and open do
not migrate an earlier format at runtime.

## Data Blocks

The API uses `nodes` for the backend representation of Data Blocks. All routes
below require the Workspace to be open.

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces/{workspace_id}/nodes` | `list_nodes` | 200 | Complete ordered Data Block collection |
| `POST /api/workspaces/{workspace_id}/nodes/exports` | `export_data_blocks` | 200 file / ZIP | Export an ordered Data Block selection in one requested format |
| `POST /api/workspaces/{workspace_id}/nodes` | `create_node` | 201 | Create a source or typed derived Data Block |
| `POST /api/workspaces/{workspace_id}/nodes/previews` | `preview_node_creation` | 200 Arrow | Side-effect-free derived Data Block row page |
| `PUT /api/workspaces/{workspace_id}/nodes/order` | `reorder_workspace_nodes_by_id` | 200 | Persist the complete Data Block order |
| `GET /api/workspaces/{workspace_id}/nodes/{node_id}` | `get_node` | 200 | Read complete Data Block metadata |
| `PATCH /api/workspaces/{workspace_id}/nodes/{node_id}` | `update_node` | 200 | Update Data Block name, document column, tokenizer model, or color metadata |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/edits` | `edit_node` | 200 | Replace the selected Data Block plan with a typed identity-preserving edit |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/undo` | `undo_node` | 200 | Restore the previous plan from this open Workspace session |
| `POST /api/workspaces/{workspace_id}/nodes/{node_id}/redo` | `redo_node` | 200 | Restore the next plan from this open Workspace session |
| `DELETE /api/workspaces/{workspace_id}/nodes/{node_id}` | `delete_node` | 204 | Delete while preserving graph integrity |
| `GET /api/workspaces/{workspace_id}/nodes/{node_id}/schema` | `get_node_schema` | 200 Arrow | Authoritative zero-row Data Block schema stream |

`DataBlockExportRequest` requires one or more unique Data Block UUIDs in export
order and accepts `csv`, `json`, `ndjson`, `parquet`, or `ipc`. There is no
arbitrary selection-count maximum. One Data Block returns its file directly;
multiple Data Blocks return one backend-built ZIP with one file per Data Block.
Export operates on a stable Workspace view and is bounded by response-snapshot
storage admission.

`NodeEditRequest` accepts `cast`, `rename_column`, `delete_column`, `filter`,
`replace`, `expression`, `set_cell`, or `annotation_classes`. `set_cell`
accepts an existing string column, absolute row index, and string or null value.
`annotation_classes` accepts class and description columns plus at most 200
validated rows; it preserves other columns positionally, truncating or
null-padding them to the new row count. Sample, Join, and Stack remain
creation-only, and cast is not part of the creation request union. Every
`WorkspaceNodeInfo` contains required `can_undo` and `can_redo` flags plus the
nullable scalar `tokenizer_model`. `NodeUpdateRequest.tokenizer_model` is an
opaque identifier of at most 500 characters; surrounding whitespace is
trimmed, and an empty string or `null` clears it. Document and tokenizer fields
are independent partial updates. Existing Data Block preferences survive
Workspace and archive round trips, while Derived Data Blocks never inherit a
Tokenizer Preference. Only the current plan is durable; both history flags
reset after load, clone, import, close/reopen, or backend restart.

## Tabs

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces/{workspace_id}/tabs` | `list_tabs` | 200 | Complete ordered Tab collection |
| `POST /api/workspaces/{workspace_id}/tabs` | `create_tab` | 201 | Create one named fixed-kind Tab |
| `GET /api/workspaces/{workspace_id}/tabs/{tab_id}` | `get_tab` | 200 | Read one Tab |
| `PATCH /api/workspaces/{workspace_id}/tabs/{tab_id}` | `update_tab` | 200 | Partially update one Tab's name or kind-specific presentation settings |
| `DELETE /api/workspaces/{workspace_id}/tabs/{tab_id}` | `delete_tab` | 204 | Cancel and remove the Tab's Analysis forest, then delete the Tab |
| `GET /api/workspaces/{workspace_id}/tabs/{tab_id}/analyses` | `list_tab_analyses` | 200 | Read the complete ordered Analysis forest |
| `POST /api/workspaces/{workspace_id}/tabs/{tab_id}/analyses` | `submit_tab_analysis` | 201 | Create one scoped Analysis, optionally with a parent and supersession targets |
| `DELETE /api/workspaces/{workspace_id}/tabs/{tab_id}/analyses` | `clear_tab_analysis` | 204 | Cancel and remove the complete Analysis forest |

Token Frequency and Topic Modelling Tabs expose normalized `stop_words`.
Topic Modelling Tabs additionally expose `topic_modeling_words_per_topic`
(3-100, default 15). These settings change only through Tab PATCH and survive
Analysis and Result lifecycle operations.

## Analyses

| Method and path | Operation ID | Success | Purpose |
|---|---|---:|---|
| `GET /api/workspaces/{workspace_id}/analyses` | `list_analyses` | 200 | Paginated live Analyses across every Tab forest |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}` | `get_analysis` | 200 | Read one live valid Analysis |
| `POST /api/workspaces/{workspace_id}/analyses/{analysis_id}/cancel` | `cancel_analysis` | 200/202 | Cancel queued work or request running cancellation |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result` | `get_analysis_result` | 200 | Stored canonical Result or durable Preview-ready marker |
| `POST /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/query` | `query_analysis_result` | 200 | Typed side-effect-free page projection, including fresh Annotation, Concordance, and Quotation Preview work |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}` | `download_analysis_table` | 200 Arrow | Complete immutable Result table |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/rows` | `get_analysis_table_rows` | 200 Arrow | Independent page from an open-ended Result table |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/schema` | `get_analysis_table_schema` | 200 Arrow | Zero-row open-ended Result table schema |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/projections/{row_unit}/rows` | `get_analysis_table_projection_rows` | 200 Arrow | Deterministic document or match page from a nested Run All Result |
| `POST /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/projections/documents/query` | `query_concordance_document_projection` | 200 Arrow | Exact-term/bin-filtered Concordance document page with filtered total-row header |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/projections/{row_unit}/schema` | `get_analysis_table_projection_schema` | 200 Arrow | Zero-row schema for a document or match projection |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/result/tables/{table_id}/density` | `get_concordance_table_density` | 200 JSON | Whole-Result Concordance density in 100 fixed bins |
| `GET /api/workspaces/{workspace_id}/analyses/{analysis_id}/artifacts/{artifact_name}` | `download_analysis_artifact` | 200 | Download a declared Analysis Artifact snapshot |

Every valid Analysis resource includes required ordered `output_node_ids`.
The list is empty until a publishing Analysis succeeds. Existing single-output
operations return one ID; Topic Modelling Data Block Creation returns topic-data then
topic-meanings IDs for each source in request order. The removed singular field
is not accepted.

`AnalysisCreate` contains one discriminated Analysis request, one execution
scope (`preview`, `run_all`, or `supporting`), an optional
`parent_analysis_id`, and ordered unique `supersedes_analysis_ids`. Parents and
supersession targets must belong to the same Tab. Parent links may have
arbitrary depth. Superseded terminal records are removed only after the
replacement succeeds. Cancelling an Analysis cascades to active descendants.
Annotation submissions are linear and must omit parents, Supporting scope, and
supersession targets. Each accepted Annotation Preview or Run All immediately
replaces the Tab's previous Analysis.

Concordance and Quotation Run All Results expose immutable projected-table
descriptors with document and match row resources. Their stored artifacts have
one row per matching document and a nested analysis list; each descriptor also
reports explicit document and match counts. Concordance descriptors expose a
whole-Result density resource. They do not create Data Blocks and therefore retain empty
`output_node_ids`. A `concordance_match_data_block_creation`,
`concordance_document_data_block_creation`, or
`quotation_result_data_block_creation` Supporting Analysis must name the
successful matching Run All parent. Match and Quotation Data Block Creation
requests select columns. Document Data Block Creation carries the exact Review
filter and optional metadata while document and extraction are implicit
required columns. Successful creation atomically commits the requested Derived
Data Blocks; only the Data Block Creation Result carries their output IDs.

`TokenFrequencyAnalysisRequest.node_tokenizer_models` must contain exactly the
selected Data Block IDs. `ConcordanceAnalysisRequest.node_tokenizer_models`
may contain any subset of selected IDs in Text mode, but must contain exactly
all selected IDs in Tokens mode. Execution and later Result projections use
these immutable request mappings and the retained input snapshot; current Data
Block preferences are never fallbacks.

## Readiness And Common Semantics

`GET /health` (`health_check`) is public. It returns `200` with `status: ready`
or `503` with `status: stopping`, plus the installed package version.

- Addressable creation returns `201` and relative `Location`; accepted import
  submission or running cancellation returns `202`; empty deletion returns
  `204`.
- A Workspace content commit advances its server-ordered Revision and returns a
  strong `ETag`. Clients do not submit `If-Match`.
- A Result before Analysis success is `409 analysis_not_succeeded`; a missing
  successful Artifact is `410 artifact_gone`; a missing retained input required
  for a completed on-demand Result query is `410 analysis_result_unavailable`.
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
