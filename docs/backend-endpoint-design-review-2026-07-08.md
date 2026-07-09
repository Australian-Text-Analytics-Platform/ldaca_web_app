# Backend Endpoint Design Review - 2026-07-08

## Scope

This review covers the current FastAPI/OpenAPI surface in this worktree after
the graph/node-info split and the new collection node-info endpoint. The
generated OpenAPI schema currently exposes 118 operations:

- 43 `GET`
- 52 `POST`
- 11 `PUT`
- 4 `PATCH`
- 8 `DELETE`

The review checks the endpoint surface against industrial API design principles:
clear resource identity, correct HTTP method semantics, explicit scoping, typed
request/response contracts, predictable task lifecycle APIs, documented errors,
and thin router modules.

## Summary

The backend is already strong in several important ways: most protected routes
use `Depends(get_current_user)`, most JSON responses have concrete OpenAPI
models, and workspace graph metadata has been split from full node metadata.
The main design debt is not one endpoint; it is a set of repeated patterns:
hidden active-workspace state, action-shaped paths, mutation data in query
parameters, analysis task route drift, duplicated OpenAPI tags, and some large
router functions that do too much orchestration.

## Findings

### 1. ~~Make workspace identity explicit in workspace-scoped routes~~

Confidence: High

Evidence:

- ~~Most workspace routes operate on the user's implicit current workspace:
  `/api/workspaces/info`, `/api/workspaces/graph`, `/api/workspaces/nodes/...`,
  `/api/workspaces/name`, `/api/workspaces/description`, `/api/workspaces/save`,
  and most analysis routes.~~ Node, transform, annotation, analysis, export,
  graph, node info, node data, metadata, save, delete, and ordering routes now
  carry `workspace_id` in the path.
- ~~`GET/POST /api/workspaces/current` mutates this hidden target.~~ Replaced
  by `GET/PUT /api/users/me/current-workspace`.
- ~~Workspace ZIP download and unload used the user's hidden current workspace:
  `/api/workspaces/download`,
  `/api/workspaces/download/tasks/{task_id}/artifact`, and
  `/api/workspaces/unload`.~~ These now use
  `/api/workspaces/{workspace_id}/download`,
  `/api/workspaces/{workspace_id}/download/tasks/{task_id}/artifact`, and
  `/api/workspaces/{workspace_id}/unload`.
- `GET/PUT /api/workspaces/{workspace_id}/tabs` already uses an explicit
  workspace id, so the API has two scoping styles.

Problem:

Hidden "current workspace" state makes requests order-dependent and harder to
reason about outside the frontend session. It complicates testing, makes
concurrent workspace interactions awkward, and weakens API locality because the
target resource is not visible in the URL.

Recommendation:

Move toward explicit workspace-scoped resources:

- ~~`GET /api/workspaces/{workspace_id}`~~
- ~~`PATCH /api/workspaces/{workspace_id}`~~
- ~~`GET /api/workspaces/{workspace_id}/graph`~~
- ~~`POST /api/workspaces/{workspace_id}/nodes`~~
- ~~`GET /api/workspaces/{workspace_id}/nodes/{node_id}/data`~~
- analysis namespaces are now workspace-scoped, e.g.
  ~~`POST /api/workspaces/{workspace_id}/token-frequencies`~~ and
  ~~`GET /api/workspaces/{workspace_id}/concordance/tasks/{task_id}/result`~~

Keep `current-workspace` only as a UI preference/session convenience, not as
the primary target selector for data-changing APIs.

Status 2026-07-08: Implemented for the route families covered by this finding.
The backend now exposes explicit UUID routes for workspace info, metadata
update, delete, save, graph, node ordering, batched node info, node data, node
creation/CRUD, node transforms, annotation, analysis, and export; the frontend
generated client and call sites pass `currentWorkspaceId` for those routes; and
OpenAPI tests assert the old hidden-current workspace paths are absent. Current
workspace selection remains a user-scoped resource at
`/api/users/me/current-workspace`.

Status 2026-07-09: Completed for remaining workspace-scoped lifecycle actions.
Workspace ZIP download, download-artifact retrieval, and unload now take
`workspace_id` in the path; inactive-row downloads package the requested
workspace directory instead of the backend's currently loaded workspace; and
OpenAPI tests assert the old hidden-current download/unload paths are absent.
The remaining unscoped workspace endpoints are intentionally collection,
import, or inventory resources: `/api/workspaces/`, `/api/workspaces/upload`,
and `/api/workspaces/tokenizer-models`.

Status 2026-07-09: Tightened internally. Decorated workspace-scoped route
handlers now receive `workspace_id` from the path and use that value for task
records, workspace directories, persistence, and export naming instead of
deriving the target id from `workspace_manager.get_current_workspace_id()`. A
unit invariant now fails if a route handler regresses to hidden current-workspace
target selection. Remaining current-workspace reads are limited to manager/cache
plumbing, explicit current-workspace UI state, and the download path's
"flush if this workspace is currently loaded" check.

Status 2026-07-09: Tightened the invariant further. Workspace-scoped routers no
longer use the `require_workspace_path` preload dependency, and route handlers
may not recover their target through
`workspace_manager.get_current_workspace()` either. Node CRUD, transforms,
annotation, base workspace operations, and analysis task submission/materialize/
detach handlers now resolve the target from the path id with `require_workspace`;
direct route-call tests pass an explicit UUID workspace id as well.

Status 2026-07-09: Tightened concordance internals. The shared concordance source
resolver now calls `require_workspace(user_id, workspace_id)` directly instead
of reading or mutating the user's hidden current-workspace pointer before
building result pages.

### 2. ~~Protect and reshape runtime config mutation~~

Confidence: High

Evidence:

- `GET /api/config/` and `POST /api/config/` have no `get_current_user`
  dependency.
- `POST /api/config/` updates `DATA_ROOT` through `os.environ["DATA_ROOT"]` and
  `reload_settings()`.
- The backend API guide says protected routes should use
  `Depends(get_current_user)`.

Problem:

Public runtime config read can be reasonable for frontend bootstrap, but public
runtime config mutation is not a safe production contract. It changes server
process state and storage root without authentication or admin authorization.

Recommendation:

Split bootstrap config from mutable admin config:

- Keep a public, read-only `GET /api/runtime-config` if the frontend needs
  `multi_user_mode` and OAuth client metadata before login.
- Move mutation to an authenticated/admin-only endpoint such as
  `PATCH /api/admin/config` with a request body.
- Make the persistence behavior explicit: either durable config write, or
  intentionally process-local temporary override.

Status 2026-07-09: Implemented. Public bootstrap metadata now lives at
`GET /api/runtime-config` and exposes only `multi_user_mode` plus
`google_client_id`. Working-directory mutation moved to
`PATCH /api/admin/config`, reuses the admin allowlist behavior, returns an
admin-only config snapshot including `data_root`, and remains explicitly
process-local by setting `DATA_ROOT` then calling `reload_settings()`. The
legacy `GET/POST /api/config/` routes are removed and backend contract tests
assert they stay absent from OpenAPI.

### 3. ~~Replace mutation query parameters with request models and resource paths~~

Confidence: High

Evidence:

- ~~`POST /api/workspaces/current?workspace_id=...`~~
- ~~`DELETE /api/workspaces/delete?workspace_id=...`~~
- ~~`PUT /api/workspaces/name?new_name=...`~~
- ~~`PUT /api/workspaces/description?description=...`~~
- ~~`POST /api/workspaces/{workspace_id}/nodes?filename=...&sheet_name=...&mode=...`~~
- ~~`POST /api/tasks/cancel?task_id=...`~~
- ~~`POST /api/tasks/clear?task_id=...`~~

Problem:

Query parameters are best for filters, projections, pagination, and other
read/query concerns. Mutations that change named state are easier to validate,
version, and extend when the resource id is in the path and the mutable fields
are in a request body.

Recommendation:

Prefer resource ids in the path and mutation fields in Pydantic request models:

- ~~`DELETE /api/workspaces/{workspace_id}`~~
- ~~`PATCH /api/workspaces/{workspace_id}` with `{ "name": ..., "description": ... }`~~
- ~~`PUT /api/users/me/current-workspace` with `{ "workspace_id": ... }`~~
- ~~`POST /api/workspaces/{workspace_id}/nodes` with `{ "filename": ..., "sheet_name": ... }`~~
- ~~`POST /api/tasks/{task_id}/cancel` or `DELETE /api/tasks/{task_id}`~~

Status 2026-07-08: Workspace lifecycle mutation query parameters are removed.
Current-workspace selection uses a body on `/api/users/me/current-workspace`;
workspace metadata and delete/save/reorder use explicit UUID resource routes.
~~Remaining TODOs: move node creation off query parameters and convert task
cancel/clear query parameters.~~

Status 2026-07-09: Completed. Node creation now uses a JSON request body on
`POST /api/workspaces/{workspace_id}/nodes`; task cancellation uses
`POST /api/tasks/{task_id}/cancel`; task record removal uses
`DELETE /api/tasks/{task_id}`; and OpenAPI tests assert the legacy query
mutation routes/parameters stay absent.

### 4. ~~Rationalize the node collection contract~~

Confidence: Medium

Evidence:

- ~~`POST /api/workspaces/{workspace_id}/nodes` creates a node from a file, but its creation
  inputs are query parameters.~~ Node creation now uses a JSON body.
- ~~`PUT /api/workspaces/{workspace_id}/nodes` returns node info for `{ "nodes": [...] }`.~~
  Node-info batch reads now use `POST /api/workspaces/{workspace_id}/nodes:batchGet`.
- `PUT` is normally an idempotent update/replace method, not a read method.

Problem:

The current shape avoids colliding with the existing `POST /nodes` add-node
route, but it leaves the collection with one method for creation and another
method for metadata retrieval whose HTTP semantics are surprising.

Recommendation:

When contract churn is acceptable, move to clearer collection APIs:

- ~~`POST /api/workspaces/{workspace_id}/nodes` for node creation with a body.~~
- ~~`POST /api/workspaces/{workspace_id}/nodes:batchGet` or
  `POST /api/workspaces/{workspace_id}/node-info:batchGet` for body-based batch
  reads.~~ Implemented as `POST /api/workspaces/{workspace_id}/nodes:batchGet`.
- Alternatively, use `GET /api/workspaces/{workspace_id}/nodes?ids=a,b` when the
  requested id list is small enough for URLs.

Status 2026-07-09: Completed. `PUT /api/workspaces/{workspace_id}/nodes` has
been removed, the generated client now posts node-info bodies to
`/nodes:batchGet`, frontend node-info helpers continue using the generated SDK
function, and OpenAPI tests assert the old `PUT` read route is absent.

### 5. ~~Standardize analysis task lifecycle routes~~

Confidence: High

Evidence:

- ~~Analysis task request/result endpoints exist under each analysis namespace:
  `/concordance/tasks/{task_id}/result`,
  `/quotation/tasks/{task_id}/result`,
  `/sequential-analysis/tasks/{task_id}/result`,
  `/token-frequencies/tasks/{task_id}/result`,
  `/topic-modeling/tasks/{task_id}/result`.~~ Request/result reads now use
  shared `GET /analysis-tasks/{task_id}/request` and
  `GET /analysis-tasks/{task_id}/result` routes.
- ~~Four result paths also accept `POST` on the same `/result` URL.~~ Removed
  for concordance, quotation, sequential analysis, and token frequencies.
- ~~`POST /concordance/tasks/{task_id}/result` is a read using body/query
  overrides.~~ Concordance now uses shared
  `POST /analysis-tasks/{task_id}/result-query`.
- ~~`POST /quotation/tasks/{task_id}/result` persists display preferences and can
  return a full result payload.~~ Quotation now uses shared `PATCH
  /analysis-tasks/{task_id}/preferences` for context preferences and shared
  `POST /analysis-tasks/{task_id}/result-query` for body-based page/sort
  refreshes.
- ~~`POST /sequential-analysis/tasks/{task_id}/result` and
  `POST /token-frequencies/tasks/{task_id}/result` persist presentation
  preferences.~~ These now use shared
  `PATCH /analysis-tasks/{task_id}/preferences`.

Problem:

Task result retrieval, result querying, and result preference updates are
overloaded onto the same URL and sometimes the same method. This makes the API
less predictable and forces clients to know analysis-specific behavior for what
is mostly a shared task lifecycle.

Recommendation:

Create a shared analysis-task resource model:

- `GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}`
- ~~`GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/request`~~
- ~~`GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/result`~~
- ~~`POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/result-query`~~
  for complex body-based result pagination/filtering when query parameters are
  not enough.
- ~~`PATCH /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/preferences`~~
  for chart type, page size, stop words, and similar display settings.
- ~~`POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/detachments`
  and `/materializations` for generated artifacts/nodes.~~
- ~~`POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/dispersion-detachments`
  and `GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/dispersion-bins`
  for concordance-specific child actions and artifact reads.~~

Keep analysis-specific payload models behind this shared task interface.

Status 2026-07-09: Request/result reads and preference/result-query writes are
implemented through the shared task resource. The backend exposes
`GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/request` and
`GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/result`, validates
that the task belongs to the workspace path, dispatches result shaping to the
owning analysis helper, and removes the old per-analysis GET request/result
routes. The frontend generated client and analysis hydration/polling call sites
now use the shared generated functions. Concordance and quotation body-based
result refreshes use `POST /analysis-tasks/{task_id}/result-query`; quotation,
sequential-analysis, and token-frequency preference updates use
`PATCH /analysis-tasks/{task_id}/preferences`; and OpenAPI tests assert the old
per-analysis GET/POST result/request routes stay absent. ~~Remaining TODO: move
detach/materialize actions under shared task resources where practical.~~

Status 2026-07-09: Task-based detach routes are now standardized.
Sequential-analysis detach and topic-modeling detach/detach-options moved from
`/sequential-analysis/tasks/{task_id}/detach` and
`/topic-modeling/tasks/{task_id}/...` to shared
`POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/detachments` and
`GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/detach-options`.
Concordance and quotation detach actions use the same shared detachments route;
concordance dispersion detach uses
`POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/dispersion-detachments`;
concordance and quotation materialization use
`POST /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/materializations`;
and materialized concordance dispersion bins use
`GET /api/workspaces/{workspace_id}/analysis-tasks/{task_id}/dispersion-bins`.
The frontend generated client and analysis call sites use the shared generated
functions, the public request bodies carry `node_id` where needed, and the
legacy node/action routes plus the old concordance bins route are absent from
OpenAPI.

Status 2026-07-09: Tightened detach request contracts. Concordance,
concordance-dispersion, and quotation detach requests now require an explicit
non-empty `selected_columns` list; the frontend always submits the dialog's
selection; and worker tasks no longer treat omitted generated-column selection
as a legacy "keep all generated columns" signal.

### 6. ~~Clarify preview and ephemeral-state endpoints~~

Confidence: Medium

Evidence:

- Many transformation previews use `POST .../preview`.
- ~~Annotation preview state uses `POST /api/workspaces/{workspace_id}/annotation/ai/preview/state`
  even though it reads cached preview rows.~~ Preview state now uses
  `GET /api/workspaces/{workspace_id}/annotation-ai-preview-sessions/{node_id}`.
- ~~Preview, override, clear, annotate-all, and detach-previewed are all sibling
  action endpoints under `/annotation/ai`.~~ These now live under the
  `annotation-ai-preview-sessions` collection/session resource.

Problem:

Using `POST` for expensive previews with complex request bodies is acceptable,
but "preview/state" and "preview/clear" read like actions rather than resources.
The lifecycle of preview sessions is a real resource concept: create preview,
read preview state, override a row, clear preview, commit/detach.

Recommendation:

Model preview sessions explicitly:

- ~~`POST /api/workspaces/{workspace_id}/annotation-ai-preview-sessions`~~
- ~~`GET /api/workspaces/{workspace_id}/annotation-ai-preview-sessions/{session_id}`~~
- ~~`PATCH /api/workspaces/{workspace_id}/annotation-ai-preview-sessions/{session_id}/rows/{row_index}`~~
- ~~`DELETE /api/workspaces/{workspace_id}/annotation-ai-preview-sessions/{session_id}`~~
- ~~`POST /api/workspaces/{workspace_id}/annotation-ai-preview-sessions/{session_id}/annotations`~~
- `POST /api/workspaces/{workspace_id}/annotation-ai-preview-sessions/{session_id}/detachments`

This improves locality and makes cache invalidation, TTL, and commit semantics
clearer.

Status 2026-07-09: Implemented. Annotation AI previews are now modeled as
node-scoped preview-session resources: create/refresh a page with
`POST /annotation-ai-preview-sessions`, read cached state with
`GET /annotation-ai-preview-sessions/{node_id}`, patch an override with
`PATCH /annotation-ai-preview-sessions/{node_id}/rows/{row_index}`, clear with
`DELETE /annotation-ai-preview-sessions/{node_id}`, annotate all through
`POST /annotation-ai-preview-sessions/{node_id}/annotations`, and detach cached
preview rows through
`POST /annotation-ai-preview-sessions/{node_id}/detachments`. The old
`/annotation/ai/preview/*`, `/annotation/ai/annotate-all`, and
`/annotation/ai/detach-previewed` routes are absent from OpenAPI. The frontend
generated client and annotation UI call sites were updated, and explicit-row
detach compatibility was removed so detachments always materialize the server
preview session.

### 7. ~~Remove duplicated OpenAPI tags~~

Confidence: High

Evidence:

- The generated OpenAPI tags frequently contain two entries, such as
  `workspace_management,nodes`, `file_management,files`, and
  `authentication,authentication`.
- This comes from both `app.include_router(..., tags=[...])` and child routers
  declaring their own `tags=[...]`.

Problem:

Duplicated and multi-level tags make generated docs noisier and weaken SDK/doc
navigation. The tag list should communicate one stable grouping per endpoint.

Recommendation:

Choose one tagging layer:

- remove broad tags from `app.include_router(...)` and keep child router tags;
  or
- remove child router tags and keep top-level tags.

Given this API has many workspace subdomains, child router tags are probably
more useful: `nodes`, `lifecycle`, `annotation`, `concordance`, etc.

Status 2026-07-08: Implemented. Top-level `app.include_router(...)` calls no
longer pass broad tags, child routers own endpoint tags, and
`test_openapi_uses_single_child_router_tag_per_operation` guards against
duplicate tag entries returning.

### 8. ~~Add explicit response models or OpenAPI response metadata for public and streaming routes~~

Confidence: Medium

Evidence:

The recursive route audit found no concrete `response_model` for:

- ~~`/api`~~
- ~~several auth redirect/status/logout routes~~
- ~~`/api/files/sample-data/readme`~~
- ~~`/api/files/raw`~~
- ~~`/api/files/{filename:path}`~~
- ~~`/api/tasks/stream`~~
- ~~`/api/workspaces/{workspace_id}/download/tasks/{task_id}/artifact`~~
- ~~`/api/workspaces/{workspace_id}/export`~~
- ~~`/api/admin/users`~~
- ~~`/api/admin/cleanup`~~

Some of these intentionally stream files or SSE events, so a JSON
`response_model` is not always right.

Problem:

Where JSON is returned, omitted models weaken generated clients. Where non-JSON
content is returned, missing OpenAPI response metadata makes content type and
download semantics less discoverable.

Recommendation:

- Add Pydantic response models for root, admin list/cleanup, auth status/logout,
  and other JSON responses.
- For file/stream endpoints, add explicit `responses={...}` metadata with
  media type, status codes, and short schema/description.
- Keep raw `Response`, `StreamingResponse`, and `FileResponse` where needed, but
  make the contract visible in OpenAPI.

Status 2026-07-09: Implemented. JSON routes now expose concrete schemas for the
API root, auth logout/status/health, and admin users/cleanup responses. OAuth
redirect routes document their `302`/`303` redirect outcomes. Raw README/text,
file download, task SSE stream, workspace ZIP artifact, and node export routes
keep their streaming/file response classes while advertising their media types
in OpenAPI. The frontend generated client was refreshed, and
`test_openapi_response_contracts.py` guards these contracts.

### 9. ~~Standardize the error contract and stop bypassing `AppError`~~

Confidence: Medium

Evidence:

- `core/exceptions.py` defines an `AppError` hierarchy specifically to avoid
  scattered `HTTPException`.
- ~~Raw `HTTPException` is still raised in auth, workspace base operations,
  concordance, and token-frequency routes.~~ First-party application modules now
  raise semantic `AppError` subclasses; raw FastAPI `HTTPException` remains only
  in `core.exceptions.py` to define the `AppError` base.
- ~~Most OpenAPI operations only document FastAPI's default `422` validation
  response, not app-level `400`, `401`, `403`, `404`, `409`, `500`, or `502`
  response envelopes.~~ Common app-level error responses are now documented with
  the shared `ErrorResponse` schema.

Problem:

Clients see mixed error sources and little generated documentation for expected
failure modes. This makes frontend error handling depend on string matching and
route-specific assumptions.

Recommendation:

- Add a standard error model such as `{ "code": "...", "message": "...", "details": ... }`.
- Add a FastAPI exception handler that serializes all `AppError` subclasses into
  that envelope.
- Replace route-level raw `HTTPException` with semantic `AppError` subclasses
  except for framework-specific redirects or OAuth library boundaries.
- Document common error responses at router or app level.

Status 2026-07-09: Implemented. The backend now serializes all
`AppError` subclasses through the existing `ErrorResponse` envelope
`{ "error": "...", "message": "...", "details": ... }`, derives stable
snake-case error codes from semantic exception class names, and documents
common app-level `400`, `401`, `403`, `404`, `409`, `410`, `500`, and `502`
responses in OpenAPI. Auth, file, workspace, annotation, analysis, and task
routes now use semantic `AppError` subclasses; tests assert the envelope on
representative failures; and `test_app_error_usage.py` fails if first-party
application code imports or raises raw FastAPI `HTTPException` outside the
`AppError` base definition.

### 10. ~~Deepen large router modules and route handlers~~

Confidence: High

Evidence:

- Large modules still exist where they aggregate many shallow routes or shared
  helpers: `annotation.py` is 945 lines, `sequential_analysis.py` is 802 lines,
  `topic_modeling.py` is 775 lines, `concordance.py` is 702 lines,
  `token_frequencies.py` is 530 lines, and `quotation.py` is 514 lines. The
  actionable endpoint-design debt in this pass was the route-owned workflow
  logic, and the latest rescan found no API route handlers over 80 lines.
- Largest route functions include ~~`cast_node` at 188 lines~~,
  ~~`calculate_token_frequencies` at 145 lines~~,
  ~~`upload_workspace_zip` at 135 lines~~, ~~`annotate_ai_all` at 115 lines~~,
  ~~`annotate_ai_preview` at 108 lines~~,
  ~~`run_sequential_analysis` at 103 lines~~, and
  ~~`run_topic_modeling` at 102 lines~~. Follow-up extraction also covered
  ~~`stream_tasks` at 100 lines~~ and ~~`export_nodes` at 97 lines~~.
- The backend API guide says routers should be thin and delegate business logic
  to core, workspace, analysis, or worker helpers.

Problem:

~~These route functions are shallow modules: their interface is just an HTTP
handler, but they contain validation, artifact path resolution, worker input
snapshotting, task registration, response shaping, and sometimes Polars
workflow details. That weakens locality because understanding an endpoint
requires reading a long route body instead of a named domain operation.~~

Recommendation:

Deepen backend modules around domain operations:

- `topic_detachment_service.detach_topics(...)`
- `node_casting_service.cast_column(...)`
- `workspace_archive_service.import_zip(...)`
- shared `analysis_task_service.submit/read/update_preferences/detach`

Routes should validate HTTP-specific inputs, call one domain module, and return
the typed response. The module interface becomes the test surface, improving
leverage and reducing duplicate endpoint logic.

Status 2026-07-09: Started. `cast_node` now delegates Polars dtype conversion
to `core.node_casting.cast_lazyframe_column`, leaving the route responsible for
workspace/node resolution, persistence, and response shaping. The route shrank
from 182 current lines to 50 lines; `test_node_casting.py` covers the new
service boundary and `test_route_handler_depth.py` guards the route from
growing back into a casting workflow.

Status 2026-07-09: Continued. `calculate_token_frequencies` now delegates
request validation, tokenizer model resolution, worker input snapshotting,
analysis task persistence, and worker submission to
`token_frequency_submission.submit_token_frequency_analysis`. The route shrank
from 145 lines to 25 lines, and `test_route_handler_depth.py` now guards both
`cast_node` and `calculate_token_frequencies` as shallow HTTP boundaries.

Status 2026-07-09: Continued. `upload_workspace_zip` now delegates ZIP
validation, safe extraction, metadata rewrite, target-directory replacement,
and workspace registry refresh to `core.workspace_archive_import.import_workspace_zip`.
The route shrank from 135 lines to 22 lines, the upload integration test still
covers the HTTP boundary, and `test_route_handler_depth.py` now guards the
upload route too.

Status 2026-07-09: Continued. `annotate_ai_preview` and `annotate_ai_all` now
delegate provider dispatch, class-option loading, preview-cache coordination,
and full-column annotation writes to
`annotation_ai_workflows.preview_annotation_ai_page` and
`annotation_ai_workflows.annotate_all_annotation_ai_rows`. The routes shrank to
32 and 36 lines, respectively; annotation AI integration tests now patch the
workflow module provider boundary; and `test_route_handler_depth.py` guards both
routes.

Status 2026-07-09: Continued. `run_sequential_analysis` and
`run_topic_modeling` now delegate request validation, input snapshotting,
analysis task persistence, and worker submission to
`sequential_analysis_submission.submit_sequential_analysis` and
`topic_modeling_submission.submit_topic_modeling`. Both routes are now 28 lines,
the sequential/topic integration subsets still pass, and
`test_route_handler_depth.py` guards both routes.

Status 2026-07-09: Continued. `stream_tasks` now delegates SSE snapshot,
heartbeat, event serialization, error-event, and unsubscribe lifecycle handling
to `core.task_streaming.task_event_stream`. The route shrank from 100 lines to
30 lines; response-contract and task-manager endpoint tests still pass; and
`test_route_handler_depth.py` guards the route.

Status 2026-07-09: Continued. `export_nodes` now delegates format validation,
visible-column projection, artifact writing, multi-node ZIP packaging, sized
`FileResponse` construction, and temp-dir cleanup to
`node_export.export_workspace_nodes_response`. The route shrank from 97 lines
to 28 lines, the export integration tests still pass, and
`test_route_handler_depth.py` guards the route. ~~Remaining TODO: rescan backend
route handlers for any newly obvious oversized or shallow endpoints.~~

Status 2026-07-09: Rescan found additional route handlers over 80 lines after
the original extraction list was exhausted:

- ~~`auth.py::cilogon_callback` at 117 lines.~~
- ~~`files/preview.py::unified_file_preview` at 103 lines.~~
- ~~`quotation.py::get_quotation` at 95 lines.~~
- ~~`base.py::add_node_to_workspace` at 94 lines.~~
- ~~`concordance.py::run_concordance` at 94 lines.~~
- ~~`nodes_join.py::join_nodes_preview` at 86 lines.~~
- ~~`annotation.py::detach_ai_previewed_rows` at 84 lines.~~

~~New TODO: inspect these in descending risk/order and extract domain helpers
where the body is workflow orchestration rather than unavoidable HTTP/OAuth
boundary code.~~

Status 2026-07-09: Continued. `detach_ai_previewed_rows` now delegates
preview-session materialization, row-index validation, child-node creation, and
dry-run counting to
`annotation_ai_workflows.detach_previewed_annotation_ai_rows`. The route shrank
from 84 lines to 43 lines, annotation AI integration tests still pass, and
`test_route_handler_depth.py` guards the route.

Status 2026-07-09: Continued. `join_nodes_preview` now delegates join-type
validation, LazyFrame join construction, preview collection, and pagination
metadata to `node_join.preview_joined_nodes`; `join_nodes` also reuses
`node_join.joined_lazyframe_for_nodes` so preview/apply no longer duplicate join
semantics. The preview/apply routes are now 30 and 39 lines, join integration
tests still pass, and `test_route_handler_depth.py` guards the preview route.

Status 2026-07-09: Continued. `add_node_to_workspace` now delegates user-file
lookup, loader normalization, dtype normalization, data-block name derivation,
parquet staging, node creation, and workspace persistence to
`node_creation.create_workspace_node_from_file`. The route shrank from 94 lines
to 28 lines, add-node integration tests still pass, and
`test_route_handler_depth.py` guards the route.

Status 2026-07-09: Continued. `run_concordance` and `get_quotation` now
delegate request validation, analysis task persistence, worker input
snapshotting, and worker submission to
`concordance_submission.submit_concordance_analysis` and
`quotation_submission.submit_quotation_analysis`. The routes shrank to 28 and
30 lines, respectively; concordance/quotation integration and preference tests
still pass; and `test_route_handler_depth.py` guards both routes. The quotation
worker also stopped importing the quotation router for on-demand page
computation; both the worker and route now use
`quotation_core.compute_remote_on_demand_page`.

Status 2026-07-09: Rescan after the submission extraction showed two remaining
route handlers over 80 lines:

- ~~`auth.py::cilogon_callback` at 117 lines.~~
- ~~`files/preview.py::unified_file_preview` at 103 lines.~~

Status 2026-07-09: Continued. `unified_file_preview` now delegates path
validation, file-type dispatch, Excel sheet handling, Polars/text/ZIP reads,
pagination, and response shaping to `file_preview.build_file_preview_response`.
The route shrank from 103 lines to 25 lines; file-preview tests still pass; and
`test_route_handler_depth.py` guards the route.

Status 2026-07-09: Completed. `cilogon_callback` now keeps only callback query
validation, CSRF cookie validation, settings checks, and redirect response
shaping in the router. CILogon discovery caching, token exchange, userinfo
fetching, verified-email/subject validation, local user provisioning, folder
path persistence, and session creation now live in `core.cilogon_auth`. The
route shrank from 117 lines to 57 lines; auth/OpenAPI route tests still pass;
and `test_route_handler_depth.py` guards the route. A full route-size rescan
found no API route handlers over 80 lines.

### 11. ~~Make file resources less dependent on catch-all path routing~~

Confidence: Medium

Evidence:

- ~~File download and delete use `/api/files/{filename:path}`.~~ File
  download now uses `GET /api/files/content?path=...`, delete uses
  `DELETE /api/files/?path=...`, and file info uses
  `GET /api/files/info?path=...`.
- Raw text uses `/api/files/raw?path=...`.
- Sample readme uses `/api/files/sample-data/readme?path=...`.
- Move/create folder use request bodies.

Problem:

Catch-all path routes are route-order-sensitive and awkward for clients when
paths contain slashes or reserved URL characters. The file API also uses three
different styles for identifying a file: path parameter, query parameter, and
body field.

Recommendation:

Pick one file identity contract:

- path in body/query for file operations, e.g. `GET /api/files/content?path=...`,
  `DELETE /api/files?path=...`; or
- stable file ids in the tree response and id-based resource routes.

If path-based ids remain, keep all path-bearing operations consistent and avoid
catch-all routes where static endpoint growth is expected.

Status 2026-07-09: Implemented for first-party file routes. The catch-all
download/delete/info routes are removed from OpenAPI; single-path file reads,
metadata reads, and deletes use a query `path`; and multi-field operations such
as move/create-folder remain body-based. The generated frontend client and file
browser hooks now call the query-path SDK functions, and
`test_openapi_response_contracts.py` guards against reintroducing catch-all file
routes.

## Recommended Order

1. ~~Protect `POST /api/config/` and split public runtime config from admin
   mutation.~~
2. ~~Remove duplicated OpenAPI tags. This is low-risk and immediately improves
   generated docs.~~
3. ~~Convert workspace/task mutation query parameters to request models and
   resource-shaped paths.~~
4. ~~Rationalize node collection reads by moving node-info batch metadata from
   `PUT /nodes` to `POST /nodes:batchGet`.~~
5. ~~Continue standardizing analysis task detach/materialization routes.~~
6. ~~Add a standard error envelope and documented common error responses; continue
   replacing non-framework raw `HTTPException` raises with semantic `AppError`
   subclasses.~~
7. ~~Deepen the largest route modules after the contracts above clarify the
   target module interfaces.~~

## Not Flagged As Problems

- `POST` for complex search/preview requests is acceptable when bodies are too
  rich for query strings.
- File download/export routes do not need JSON response models, but they should
  document their content types in OpenAPI.
- OAuth redirect routes can remain framework-specific and do not need the same
  JSON envelope as normal API routes.

## Verification

Latest validation after the 2026-07-09 backend endpoint cleanup:

- `cd backend && uv run pytest -q`
- `cd backend && uvx ty check`
- `pnpm -C frontend test -- --run`
- `pnpm -C frontend build`
- `pnpm -C frontend lint`
- `git diff --check`
- `git -C backend diff --check`
