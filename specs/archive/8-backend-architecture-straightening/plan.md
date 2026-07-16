# Backend Architecture Straightening Plan

Status: completed
Completed: 2026-07-16
Scope: backend only

## Approach

Build the target backend around resource ownership rather than adapting the
current Task and resident-Workspace mechanisms. Each milestone replaces one
complete ownership boundary and removes what it supersedes. No compatibility
alias remains between milestones.

Current architecture and domain pages continue to describe the running system
until the corresponding implementation lands. At completion they are rewritten
atomically to describe the resulting system, and any ADR made false by the new
design is superseded or removed according to its historical value.

## Milestone 1: Characterization and contract inventory

- Capture the backend OpenAPI schema, router inventory, persistence files,
  execution kinds, startup/shutdown order, and deployment profiles.
- Add characterization tests for Workspace mutation, Task/Analysis lifecycle,
  file imports, deletion, SSE, authentication, errors, BinderHub root paths,
  and `start_async_server()`.
- Produce a generated-symbol and raw-URL reference scan before deleting any
  route or model.
- Record the exact legacy stores and sidecars that the cutover will remove.

Verification: characterization tests pass against the pre-cutover backend and
the inventory has no unexplained route or persistent writer.

### Captured pre-cutover baseline

Captured from the working tree on 2026-07-16. This inventory describes only
the implementation being replaced; it is not a compatibility contract.

The side-effect-free OpenAPI export contains 48 operations:

| Router tag | Operations |
| --- | ---: |
| `analysis-tasks` | 6 |
| `annotations` | 3 |
| `data-portal` | 3 |
| `files` | 9 |
| `health` | 1 |
| `nodes` | 6 |
| `sample-data` | 2 |
| `session` | 5 |
| `tasks` | 5 |
| `workspace-archives` | 2 |
| `workspaces` | 6 |

The persistent owners and writers are:

| Current owner | Durable or transient path | Cutover disposition |
| --- | --- | --- |
| `Database` | `data_root/<database_file>` with schema-v5 users, identities, Sessions, Google credentials, and OAuth transactions | Retain identity concerns, replace the strict schema with the accepted quota-bearing schema |
| `TaskRepository` | `data_root/task_state/tasks.sqlite3`, `task-store.owner`, and optional quarantine JSON | Remove completely after Analysis and User File import state move to their owning resources |
| `WorkspaceStore` | `users/<principal>/user_workspaces/<workspace-id>/metadata.json` plus generation-named plan files | Replace with global `workspaces/<id>/`, strict `workspace.json`, `access.json`, Tabs, and Analyses |
| `TaskArtifactService` | Workspace `data/artifacts/task_inputs/<task-id>/` and `task_outputs/<task-id>/` | Replace task ownership with Analysis-owned inputs, Results, and Artifacts |
| `UserFileStore` | `users/<principal>/user_data/` plus `.wordflow-task-staging/` | Retain User Files under the simplified user layout and replace generic task staging with UserFileImport-owned staging |
| Analysis caches | `users/<principal>/user_cache/` and task-result cache paths | Remove durable execution caches that exist only to avoid affordable recomputation |
| `ResponseSnapshotService` | `data_root/.response-snapshots/resources/` | Retain as response-lifetime transient storage, with no resource lifecycle authority |
| Workspace/archive staging | safe-import marker folders, generated exports, node-source temporary files, and archive staging | Replace with the accepted `workspaces/.staging/` and `.trash/` publication and cleanup boundaries |

The generic Task registry has 13 kinds: five root analyses, five
materialization or detachment children, annotation, sample import, and Data
Portal import. `TaskService` currently owns global and per-user admission,
process and async-I/O semaphores, persistence, cancellation, completion,
Artifacts, and SSE. This entire ownership cluster is replaced by the private
Analysis scheduler, Analysis-owned lifecycle, the independent
UserFileImportService, and the shared live event hub.

Startup currently initializes and locks storage, validates SQLite, enters the
runtime task group, constructs storage and Workspace services, initializes
Sessions and providers, registers every Task definition, restores Tasks and
Artifacts, then starts maintenance. Shutdown closes maintenance and
`TaskService`, joins the task group, then unwinds Data Portal, sample HTTP,
process execution, providers, Workspace residency, and the Data Root lock.
This is the baseline against which the accepted stopping-readiness and bounded
interruption order is characterized.

Supported launch profiles are split Uvicorn/Vite development, bundled CLI
production, Tauri-supervised port-zero startup, direct ASGI hosting, and the
BinderHub/JupyterHub `start_async_server()` profile with derived proxy
`root_path`.

The generated-symbol and raw-URL scan found that the checked-in frontend
generated client predates the current 48-operation backend and contains older
routes. Handwritten frontend URLs exist for the two OAuth entry points and the
old Task stream. They are recorded consumers for the later frontend project,
not reasons to retain backend aliases. Backend Task symbols are concentrated
in runtime composition, Task/Analysis/import modules, architecture documents,
and their characterization tests; the zero-reference scan is repeated when
that ownership cluster is deleted.

Characterization evidence is concentrated in
`test_app_factory_runtime.py`, `test_workspace_resource_api.py`,
`test_workspace_service.py`, `test_workspace_lifecycle_service.py`,
`test_analysis_task_contract.py`, `test_task_service.py`,
`test_sample_import_contract.py`, `test_data_portal_contract.py`,
`test_session_cookie_contract.py`, `test_server_launcher.py`, and the OpenAPI
surface and architecture tests. The focused baseline is 91 passing tests.

## Milestone 2: Runtime, request, and security foundations

- Finish immutable bootstrap settings and side-effect-free `create_app`.
- Make lifespan the sole owner of database, services, task groups, executors,
  providers, capacity limiters, event hub, and Data Root lock.
- Enforce reverse-order startup unwinding and bounded shutdown. Add the
  positive finite immutable `shutdown_grace_seconds`, defaulting to 10 with no
  unlimited value; make readiness stopping, reject submissions, stop dispatch,
  fail queued resources as interrupted, and terminate running executors
  concurrently within that one deadline.
- Preserve success when it commits first and `cancelled` only when a user
  cancellation was already pending. Otherwise make confirmed shutdown
  termination `analysis_interrupted` or `user_file_import_interrupted` without
  setting `cancellation_requested_at`. Force-kill or cancel at the deadline and
  leave any uncommitted non-terminal record for deterministic startup
  reconciliation rather than resuming it.
- Close executors before Workspace slots, event subscribers, provider clients,
  SQLite, and logging resources.
- Standardize request IDs, safe domain errors, sanitized validation errors,
  package versioning, and minimal readiness health.
- Finish the hosted cookie/Session/CSRF and desktop process-identity profiles.
- Persist the fixed single-user principal through the same `users` table used
  by hosted identities, explicitly storing a `NULL` storage limit while
  retaining process-scoped desktop authentication and CSRF.
- Preserve split development, bundled production, Tauri supervision, and
  BinderHub notebook startup through one application factory.

Verification: two isolated app instances, partial-startup unwind, exact
shutdown ordering, queued interruption, running success/user-cancel/system-stop
races, deadline force-stop, restart reconciliation, cross-user shutdown
isolation, auth/CSRF/Origin tests, OpenAPI export without lifespan, launcher
tests, and BinderHub integration tests.

## Milestone 3: Storage layout and Workspace authority

- Make the filesystem the sole durable Workspace catalogue. Keep live folders
  at `data_root/workspaces/<workspace-id>/`, creation/import staging under
  `workspaces/.staging/`, deletion cleanup under `workspaces/.trash/`, and User
  Files under `users/<user-id>/`.
- Add a strict deployment-only `access.json` to every Workspace folder with
  exactly one owner and no sharing fields. Exclude it from export, reject it in
  uploaded archives, and generate it for the current principal on creation or
  import.
- Remove every Workspace catalogue, ownership mapping, creation state, and
  deletion tombstone from SQLite. Retain SQLite only for users and their
  storage policy, identity, Session, and OAuth state.
- Make every Workspace collection request perform a fresh bounded filesystem
  scan and make direct lookup validate the exact folder and sidecar. Add no
  in-memory catalogue cache, watcher, TTL, invalidation layer, per-user pointer,
  or use of the transient slot table as a discovery index.
- Isolate scan corruption per folder: skip and log unattributable invalid
  entries; omit a current user's corrupt Workspace while returning valid
  siblings; fail direct access with `500 workspace_corrupt`; and allow deletion
  and quota attribution when `access.json` remains valid. Add no partial-result
  wrapper, placeholder, fallback parser, repair, or quarantine path.
- Make direct creation and archive import publish a durable closed Workspace
  with `201` and `Location`; accept no implicit-open option and require the
  explicit open subresource for runtime loading.
- Publish creation/import through one same-filesystem atomic rename from
  `.staging/` into the live directory, and make startup remove interrupted
  staging folders rather than completing them heuristically.
- Introduce the central owner-access boundary backed by `access.json`; return
  `404` on mismatch and keep routes unaware of ownership representation.
- Add nullable `users.storage_quota_bytes` with database default
  `32212254720` (30 GiB) and a positive-or-null constraint. Let `NULL` mean
  unlimited in every profile, use the default for new hosted users, and
  explicitly store `NULL` for the startup-provisioned single-user row.
- Construct the same `QuotaService` and invoke the same storage-admission API
  in every profile. Let a `NULL` user limit produce an unlimited no-op quota
  reservation while retaining the separate mode-independent physical
  free-space and process-safety admission.
- Define quota bytes as filesystem allocation, not logical file length. Probe
  the hosted Data Root for reliable allocated-block and allocation-unit
  metrics, such as `st_blocks * 512` and the filesystem fragment size. Charge
  each regular file and directory the greater of its reported allocation and
  one allocation unit so zero-byte entries cannot bypass the single byte
  quota. Fail hosted readiness if either metric is unavailable rather than
  falling back to `st_size`; an unlimited policy requires no probe or scan.
- For a finite limit, derive quota usage by scanning the user's durable User
  File/import area plus live and trashed Workspace folders whose `access.json`
  names that owner, then add process-local write reservations under one
  per-user quota gate. Reload the SQLite limit and recheck the actual positive
  size delta before atomic publication; persist no usage ledger, counter, or
  reconciliation state.
- Add one `QuotaService` status operation that captures the fresh durable scan
  and current reservations under the same per-user gate. Add no cache,
  background counter, or persisted usage projection.
- Add no quota-administration endpoint in this change. Accept a committed
  transactional SQLite update as the temporary operator interface and observe
  it on the next status or admission check. When a limit is lowered below
  usage, preserve data and reads/deletion but reject positive growth, including
  final publication of newly over-limit staged output.
- Replace the catch-all storage-capacity exception with two HTTP `507` domain
  errors: `storage_quota_exceeded` for the current user's finite limit and
  `storage_capacity_exceeded` for the shared physical free-space reserve.
  Check quota first, expose no physical-capacity details, and keep
  `backend_capacity_exceeded` as a separate HTTP `503` process-memory failure.
- Populate quota `ApiError.details` from the failing atomic admission snapshot
  with exactly `limit_bytes`, `used_bytes`, `reserved_bytes`, and
  `requested_growth_bytes`. Permit zero requested growth after a concurrent
  limit reduction. Omit details entirely for shared physical-capacity errors.
- Remove per-user Workspace, entry-count, active-work, retention, concurrency,
  and resident-object quotas.
- Replace per-user residency and detached mutation paths with transient
  per-Workspace slots inside `WorkspaceService`. Each slot owns one gate and at
  most one loaded aggregate, exists only while used, open, or closing, and
  never serves as a filesystem catalogue or metadata cache.
- Serialize concurrent opens through the slot gate. The first caller loads;
  later callers wait and return the same direct `200 Workspace`. Use no shared
  load future or public opening state, and allow a complete load retry after
  failure.
- Add explicit idempotent open and close operations; make all Workspaces closed
  after startup and return `workspace_not_open` for ordinary closed-Workspace
  operations.
- Expose open state only through `PUT` and `DELETE` on the singleton
  `/workspaces/{workspace_id}/open` subresource; remove load, unload, save, and
  selected/current-Workspace endpoints rather than retaining aliases.
- Close immediately when no Workspace-owned work is non-terminal; otherwise
  return acceptance, reject new external work, continue internal dispatch of
  Analyses already queued before close, let all admitted work finish, and have
  the final terminal handler remove the drained aggregate and idle slot without
  polling or automatic cancellation.
- While closing, allow reads/downloads, SSE observation, cancellation or
  deletion of existing work, reopen, repeated close, and Workspace deletion.
  Reject new work, Result queries, export, metadata changes, and Data Block
  mutations with `409 workspace_closing`; after removal, child access returns
  `workspace_not_open`.
- Make open cancel a pending close; serialize it against final completion so it
  either retains the existing aggregate or performs one normal reload after
  cleanup.
- Remove automatic loading, LRU and idle eviction, resident-object limits, and
  the backend-selected current-Workspace pointer.
- In hosted mode, track one process-wide byte reservation for each open
  Workspace's validated serialized snapshot. Admit open and positive mutation
  growth through a short global capacity guard, return
  `503 backend_capacity_exceeded` without changing state when full, and never
  evict. Construct no aggregate open-Workspace cap in single-user modes.
- Return one lightweight `Workspace` model from collection and individual
  reads in every runtime state; include derived `runtime_state`, publish its
  changes over SSE, and never persist it into Workspace content or archives.
- Require aware UTC `created_at` and `modified_at` in `workspace.json`. Update
  `modified_at` with every committed user-visible Workspace, Data Block,
  root or child Analysis change, but not for progress-only updates,
  reads, export, runtime open/close, or event delivery.
- On direct creation and archive import, initialize both timestamps to one aware
  UTC publication instant. Validate but replace archived timestamps because
  import creates a new Workspace ID and resource.
- Sort every Workspace collection by `modified_at` descending and Workspace ID
  ascending. Read the domain timestamp from Workspace metadata and never
  substitute filesystem mtime or directory iteration order.
- Remove the summary/detail split and embedded or nullable graph. Keep complete
  graph topology, Tabs, and Analyses in child resources that require an open
  Workspace; metadata reads must not register or retain a closed aggregate.
- Enforce one closed-Workspace boundary: permit collection and individual
  metadata reads plus deletion, and let collection-level archive import create
  a new closed Workspace. Require open state for metadata updates, export,
  graph and Data Block access, Tabs, and every Analysis resource; add no
  detached-load fallback.
- Make all Workspace, graph, archive, deletion, and completion mutations submit
  narrow typed method calls through `WorkspaceService`. Use “command” only for
  the mutation intent; do not add a command object hierarchy, bus, generic
  dispatcher, CQRS layer, or event-sourced command log.
- Make Workspace deletion an immediate logical removal through one
  same-filesystem atomic rename into `.trash/`, publish `workspace_removed`,
  and return empty `204`. Cancel and drain existing work, clean physical bytes
  through bounded internal maintenance, attribute trash through its retained
  `access.json`, and retry trash cleanup at startup without a SQLite tombstone,
  deleting state, Task, or polling resource.
- Use the Workspace gate for every contained root and child Analysis lifecycle
  write; do not introduce per-Analysis locks.
- Keep client-window focus and active-editing coordination out of backend
  state; do not add edit leases, heartbeats, takeovers, or fencing tokens.
- Apply one concurrency rule to every mutation: serialize through the
  Workspace gate, validate current state, and commit if valid; do not add
  expected-Revision or command-category conflict policies.
- Persist strict JSON resources through temp write, file and directory `fsync`,
  and atomic replace.
- Add explicit plan-source bindings and deterministic relocation.

Verification: owner concealment, fresh-scan listing and direct lookup,
filesystem changes reflected without cache invalidation, corrupt-sibling
omission, direct corruption errors, corrupt-owner deletion and quota charging,
separate-user isolation, filesystem-derived quota usage, concurrent
reservation admission, allocated replacement-size deltas, the one-unit floor
for empty files and directories, sparse-file accounting, hosted
allocation-capability failure, 30 GiB hosted defaults, unlimited single-user
provisioning, committed quota changes during active work, cancellation and
crash cleanup, absence of a quota ledger or logical-size fallback, hosted
open-Workspace capacity admission and release, capacity rejection without
eviction or partial mutation, uncapped single-user open state,
closed-on-create and closed-on-import responses, exact idempotent `/open`
response contracts, explicit and concurrent single-load open,
failed-load complete retry, immediate and deferred close, reopen during
deferred close, reopen/final-completion races,
closed metadata reads and deletion without loading, closed update/export/child
resource errors, closing-state observation and cancellation, closing-state
mutation rejection, import creating a separate closed Workspace, runtime-state
projections and SSE changes, immediate logical Workspace deletion, trashed-byte
owner attribution, crash-resumed physical cleanup,
final-completion cleanup, separate-user concurrency, separate-Workspace
concurrency, same-Workspace serialization without lock-order deadlocks,
concurrent and out-of-order client-instance requests, uniform current-state
validation, exact `modified_at` update boundaries, deterministic Workspace
collection ordering independent of filesystem metadata, import timestamp
replacement, export/import identity, atomic publication, crash reconciliation,
and archive rollback.

## Milestone 4: Data Block graph and provenance

- Replace operation strings with a discriminated `Derivation` model.
- Represent ordered inputs and roles explicitly for unary and multi-input
  operations.
- Generate display descriptions from structured provenance.
- Implement descendant-preserving Data Block deletion through provenance
  composition and graph rewiring. Reject the complete mutation atomically with
  `409 data_block_in_use` when the removed block or any descendant whose
  provenance would change has an active Analysis input reservation.
- Reject unknown derivations, invalid roles, cycles, missing sources, and
  destination escapes.
- Remove all old operation parsing and compatibility fields.

Verification: every derivation kind round-trips strictly; deletion tests cover
chains, branches, joins, concatenation, name collisions, invalid compositions,
and atomic rollback.

## Milestone 5: Tabs and Analysis-owned lifecycle

- Define a strict first-class `Tab` resource with UUID, immutable analysis kind,
  bounded non-empty name, nullable `analysis_id`, aware UTC timestamps, and
  Revision beneath `tabs/<tab-id>/`.
- Record the analysis kind selected implicitly by the frontend function area in
  the Tab-creation request, return it for reconstruction and grouping, and add
  no later kind-change operation.
- Define strict `TabCreate` with exactly required `kind` and `name`. Generate the
  UUID, null Analysis association, one initial timestamp, and Revision 1 on the
  backend, return `201 Tab` plus `Location`, and add no default-name generator,
  numbering hint, or per-kind counter.
- Make the UUID the sole Tab identity and treat `name` as a non-unique display
  label. Add no name index, equality normalization, lookup-by-name behavior, or
  create/rename conflict, and preserve duplicates through archive round-trips.
- Define one `TabName` type that strips outer Unicode whitespace, accepts 1–500
  code points, rejects Unicode `Cc` controls, preserves every other code point
  without normalization, and is reused by create, rename, persistence, and
  staged archive validation.
- Make rename idempotent after `TabName` validation. Return the current `Tab`
  with `200` when the post-trim value is unchanged and skip every Tab/Workspace
  write, timestamp/Revision advance, and SSE event; commit all of those only for
  a changed value.
- Create the durable backend Tab immediately when the client adds one, even
  before Analysis submission. Expose narrow collection, detail, create, rename,
  and delete operations; remove whole-state replacement and free-form settings.
- Make Tab deletion addressable rather than idempotent-by-absence. Deleting an
  existing Tab returns empty `204` and detaches its current Analysis through the
  ordinary cleanup rule; a missing or repeatedly deleted Tab returns
  side-effect-free `404 tab_not_found`. Keep only the clear-Analysis operation
  idempotent for an already-empty existing Tab.
- Return the complete unpaginated Tab collection by immutable `created_at`
  ascending and Tab ID ascending. Persist no position, expose no reorder
  endpoint, and keep the active Tab entirely outside backend state.
- Define one strict `Tab` response with exact fields `id`, `kind`, `name`,
  nullable `analysis_id`, aware UTC `created_at` and `modified_at`, and
  non-negative `revision`. Return `GET .../tabs` as a raw `list[Tab]`, including
  `[]`, with no wrapper, pagination, kind filter, or kind-specific aliases; let
  the frontend group the complete result.
- Publish every validated Tab record through the shared crash-safe atomic-write
  primitive under the Workspace gate, and validate imported Tabs before
  archive publication. Add no `CorruptTab` public variant, partial collection,
  compatibility reader, automatic repair, or per-Tab deletion bypass. If an
  invalid record is encountered, return safe `500 tab_corrupt` for the affected
  Workspace operation, preserve the bytes, and keep closed metadata,
  authorized Workspace deletion, valid sibling Workspaces, and other users
  available.
- Keep every unsubmitted analysis draft exclusively in frontend-local state.
  Add no draft model, Tab field, persistence file, autosave endpoint, or SSE
  event, and do not change Workspace state while parameters are edited.
- Define strict Analysis request, lifecycle, Result, integrity, Artifact, and
  Result-query models.
- Persist Tabs and Analyses as distinct Workspace-owned resources. Make the
  Tab's nullable `analysis_id` the sole durable association to a root Analysis,
  keep `tab_id` and the Tab name out of Analysis persistence, and reject
  duplicate root references. Give children a non-null `parent_analysis_id` that
  names a root and reject child-to-child nesting.
- Derive the live paginated Analysis collection from Tab-referenced roots and
  their valid direct children. Treat every unreferenced root, child without a
  live root, or attempted grandchild directory as private cleanup state and
  remove it deterministically during current-process or startup maintenance.
- Accept one complete kind-discriminated request when Run is invoked, validate
  it and its current Data Block references under the Workspace gate, and copy it
  unchanged into a new immutable Analysis. Create the unique Analysis only for
  an empty Tab, durably stage its record before committing the Tab reference,
  and return `409 tab_analysis_exists` rather than replacing an existing
  Analysis implicitly.
- Validate the request discriminator against the Tab's immutable kind before
  input lookup or Analysis staging. Return side-effect-free
  `409 analysis_kind_mismatch` when they differ; do not trust frontend
  navigation to preserve this invariant.
- Reject a structurally valid request with absent Data Block references as
  `409 analysis_input_missing` before staging or publishing an Analysis. Return
  the missing requested IDs safely, leave the Tab empty, and produce no
  Revision, timestamp, persistence, or event side effect.
- Derive shared input reservations from every queued or running Analysis and
  its immutable Data Block IDs. Persist no separate lock record or counter;
  allow concurrent readers and reject every Data Block mutation whose complete
  affected set intersects a reservation with `409 data_block_in_use`.
- Omit creator, owner, and user-identity fields from portable Tab and Analysis
  records; both inherit Workspace authorization.
- Return Analyses by immutable `created_at` descending and Analysis ID
  ascending without storing positions or a reorder sidecar.
- Use one complete strict `Analysis` representation for creation, current-Tab
  reads, direct reads, and every valid paginated collection item. Include the
  immutable submitted request and lifecycle metadata, keep Result rows,
  previews, Artifact bytes, and presentation state in their own resources, and
  add no summary/detail model pair or hydration endpoint.
- Define its exact fields as ID, nullable parent Analysis ID, immutable
  discriminated request, lifecycle state, shared progress, nullable
  cancellation request time, nullable safe failure, integrity,
  created/started/finished timestamps, and Revision. Enforce state-dependent
  nullability, use `request.kind` as the sole kind value, and omit Workspace/Tab
  identity, names, deployment identity, `modified_at`, availability flags,
  status URLs, and links.
- Replace parallel terminal error fields with one shared nullable
  `Failure {code, message}` across Analysis and UserFileImport. Require a stable
  lowercase code and safe message of at most
  500 Unicode code points, preserve expected domain failures, map unexpected
  exceptions to resource-specific generic failures, and keep full diagnostics
  only in correlated structured logs. Reuse neither HTTP `ApiError` nor its
  request ID/details shape, and persist no traceback, exception type, path,
  provider response, input, retry flag, or raw exception text.
- Define one exact Progress value for Analysis and UserFileImport REST and SSE
  representations: nullable finite fraction from
  0.0 through 1.0 and nullable safe backend-authored message bounded to 500
  Unicode code points. Use null fraction for indeterminate work, initialize
  queued work at 0.0, finish success at 1.0, retain the latest meaningful value
  on failure or cancellation, and add no count, unit, phase, substep, or
  kind-specific variants.
- Return a minimal typed `CorruptAnalysis` collection item when a UUID-named
  Analysis record is invalid. Place corrupt items after valid Analyses in ID
  order, fail their direct reads safely, and keep valid Tabs available.
- Move execution state from the Task database into `analysis.json`.
- Add one dedicated Analysis cancellation operation at
  `POST .../analyses/{analysis_id}/cancel`. For queued work, race dispatch only
  through the Workspace gate, atomically invalidate scheduling and commit
  `cancelled`, set equal request and finish timestamps, retain null start time
  and queued Progress, publish one terminal event, and return `200 Analysis`
  without starting a process or cleanup job. For running work, persist the
  first cancellation request timestamp, signal the private executor, retain the
  Analysis on its Tab, and return `202 Analysis` until termination is confirmed.
  Make repeated pending requests side-effect-free, return `200 Analysis` once
  cancelled, and reject succeeded or failed resources with
  `409 analysis_not_cancellable`; do not conflate cancellation with clear.
- Serialize success and cancellation-confirmation callbacks through the
  Workspace gate and permanently accept the first valid terminal transition.
  Preserve `cancellation_requested_at` even when success wins, discard the
  losing callback, and add no cancellation priority, grace period, rollback,
  terminal rewrite, or extra lock.
- Represent explicit user-requested, independently observable follow-up work as
  an ordinary child Analysis with a non-null `parent_analysis_id`. Permit zero
  or many direct children beneath a root but no grandchildren, use the same
  model/lifecycle/persistence/cancellation/SSE paths for both, and isolate child
  failure or cancellation from the root. Transfer a successfully published
  Data Block into independent Workspace graph ownership so it survives root
  clear. Create children only through `POST .../analyses/{analysis_id}/children`
  when the addressed Analysis is a compatible root, and use ordinary Analysis
  endpoints thereafter. Keep Result projections as ordinary reads. Remove
  `AnalysisOperation`, automatic materialization/cache tasks, shared partial
  results, generic Task child submission, `materialization_task_id`, and cache
  fast paths; detachment recomputes its complete required output when necessary.
- Remove persisted presentation-preference payloads, versions, models, and
  mutation endpoints. Make every server-side Result projection an explicit
  typed query and leave temporary display state to the frontend.
- Replace generic Task execution with one lifespan-owned private Analysis
  scheduler and one private Analysis process executor. Let the scheduler own
  runtime-only queues and global host-safety admission through the positive
  finite immutable `analysis_execution_capacity` setting. Let the executor
  retain only each selected private launch entry, eventual child-process handle,
  and validated progress and completion IPC, using one fresh `spawn` child per
  dispatched Analysis. Remove
  the current
  hard-coded settings ceiling, support no unlimited value, and use the same
  default of two in every profile when the operator does not override it.
  Persist creation before capacity waiting, leave saturated Analyses queued and
  observable, and return no saturation error. Do not derive capacity from CPU
  count or inject a cross-library native-thread budget; retain each supported
  library's ordinary threading policy. Add no queue-count limit, reusable
  process pool, Analysis thread mode, executor fallback, per-kind CPU weight,
  or per-user execution quota.
- Make scheduling work-conserving and fair by user: fill all available slots,
  rotate one dispatch turn per active user, and select each user's oldest
  Analysis by creation time then ID. Give a newly active user a turn before the
  most recently dispatched user repeats, without preempting running work. Add
  no priority, weight, reserved execution slot, per-user concurrency limit,
  durable queue state, portable user identity, or generic Task scheduler.
  Single-user mode uses the same path as FIFO.
- Define `running` as executor admission, including child-process startup.
  After capacity and snapshot preparation, install one private launch entry
  before releasing the Workspace gate and commit `queued` to `running` with
  `started_at`; add no public or durable `starting` state. Serialize launch and
  cancellation within that entry so cancellation may suppress an unstarted
  child or terminate a started one. Map process-creation failure to isolated
  `analysis_start_failed`, clean staging, release capacity, continue scheduling,
  and add no retry or fallback executor.
- End the Workspace lease after immutable input preparation; executors retain
  only snapshots, resource IDs, and execution-private staging or Artifact paths;
  progress or completion re-enters `WorkspaceService` through an ordinary
  short command on the application event loop. Never pass a mutable Workspace,
  service, database connection, or request object into the child process.
- Store only Data Block IDs in queued Analysis requests. After fair scheduling
  reserves capacity, re-enter the Workspace gate, verify the derived
  reservations and build the temporary immutable snapshot only at dispatch.
  Treat an unexpectedly absent or unreadable reserved input as storage-integrity
  failure: fail the owning queued Analysis with `analysis_input_missing`, null
  `started_at`, queued Progress, no process, and released capacity. Commit
  running only with a valid snapshot and remove snapshot staging after every
  terminal or cleanup path. Assert the reservation invariant once more before
  completion publication; discard unpublished output and fail only the owning
  Analysis if storage corruption made an input absent.
- Keep each reservation through queued and running state, Workspace close, and
  detached cancellation after clear or Tab deletion. Release it only in the
  durable succeeded, failed, or cancelled transition. Let whole-Workspace
  deletion cancel work and remove the aggregate through its existing lifecycle
  instead of treating it as an individual Data Block mutation.
- Keep Analysis reads side-effect-free. Compute integrity from current inputs
  without changing lifecycle state, requesting cancellation, publishing an
  event, or advancing a Revision. After reservations are released, retain
  completed history with invalid integrity when an input is deleted.
- Implement cancellation confirmation, completion idempotence, input-integrity
  checks, and fail-interrupted restart reconciliation without partial resume.
- Implement idempotent clear results by atomically nulling `Tab.analysis_id`
  before returning empty `204`. Cancel queued work synchronously in the same
  gated command; for running work, retain reservations and request executor
  termination in the background. Ignore every late callback whose ID is no
  longer current, and physically delete the detached Analysis through retryable
  internal maintenance while allowing immediate resubmission subject to
  ordinary quota and capacity admission.
- Apply the same pointer-only clear to corrupt Analysis records without parsing
  their JSON or following contained links.
- Keep intermediate progress as process-local state: update the live resource
  through its ordinary gate, publish the shared Progress over SSE, and return it
  from REST without writing JSON, advancing durable Revision, or changing
  Workspace `modified_at`. Persist queued Progress at creation and final
  Progress with the terminal transition. Accept loss of intermediate progress
  on crash before fail-interrupted reconciliation, and add no throttle,
  coalescing timer, journal, sidecar, or periodic persistence job.
- Validate each live Progress report strictly at the service boundary. On an
  invalid shape, non-finite or out-of-range fraction, or overlong message, fail
  only the owning background resource with `progress_invalid` and request its
  executor termination. Remove clamping, truncation, coercion, and silent
  malformed-report drops; continue ignoring callbacks whose resource is already
  terminal or absent as stale.
- Enforce ordered Progress: permit only the first running transition from queued
  zero to indeterminate null, allow null to become determinate, and thereafter
  require non-decreasing numeric fractions with no return to null. Permit
  message changes at equal fractions. Reserve 1.0 for the atomic service-owned
  `succeeded` commit; remove worker 1.0 completion reports and the current 0.99
  rewind without changing the computation algorithms, and treat violations as
  `progress_invalid`.
- Remove Task definitions, Task repositories, Task database, public Task
  models, global Task routes, and tab-to-Task references.

Verification: immediate empty-Tab creation and persistence, strict rename and
deletion, exact two-field creation validation, backend-generated identity,
initial null association, equal timestamps, Revision 1, `Location`, and absence
of name-generation or numbering state, function-determined immutable analysis
kind across creation, reopen, and import with no kind-change operation,
side-effect-free mismatched-kind rejection before input lookup or staging,
duplicate Tab names and name variants across create, rename, reload, and
archive round-trip, exact trim, length,
control-character, punctuation, path-separator, and non-normalized Unicode name
validation, exact changed and normalized-no-op rename persistence, Revision,
timestamp, and SSE behavior, UUID-only addressing, no Analysis name or legacy
whole-state Tab replacement, no backend Tab position, reorder route, or
active-Tab state, stable complete creation-order listing across rename,
Analysis transitions, clear, reload, and archive round-trip, no Tab collection
wrapper, pagination, kind filter, alias, or extra response field, exact
empty-list behavior and timestamp/Revision boundaries, atomic Tab publication,
staged-import validation, whole-collection `tab_corrupt` failure with preserved
bytes and isolated sibling availability, absence of `CorruptTab`, automatic
repair, partial output, or compatibility parsing, exact existing, missing, and
repeated Tab-deletion responses and side effects, no backend draft field,
persistence, route, Revision change, or event, complete typed submission and
immutable request snapshotting,
zero-or-one association validation, duplicate-reference rejection, submission
to empty and occupied Tabs, atomic missing-input rejection without a failed
Analysis or side effects, cancellation request persistence, exact new,
pending, confirmed, and non-cancellable response contracts, idempotent repeated
cancellation without Revision or event churn, synchronous queued cancellation
with no process or pending state, dispatch-versus-cancel gate races, Analysis
retention after cancel,
first-terminal-wins completion/cancellation races with preserved request time
and discarded late callbacks, immediate clear-and-resubmit, cancellation and
late-completion races after clear, unreferenced-directory cleanup and restart
retry, corrupt Analysis clear, all Analysis lifecycle transitions,
deferred-close races, progress and completion against open-or-closing state,
fail-interrupted restart, staging cleanup, complete explicit retry, inputs
reserved from submission through terminal state, concurrent shared readers,
strict Data Block mutation rejection across the complete affected set,
reservation retention after clear and Workspace close, release on every
terminal path, no separately persisted lock state, dispatch-time-only
snapshots, queued storage-integrity failure without process start,
side-effect-free integrity reads, completed-input deletion after reservation
release, executor admission timestamps, cancellation before child launch,
isolated process-start failure, missing
Artifacts, absence of Tab or Analysis user
identity and persisted presentation state, side-effect-free Result queries,
one-model Analysis creation/list/detail/current-Tab consistency, absence of
summary/detail and hydration contracts, exact Analysis fields and state
invariants with no duplicated context or kind, deterministic valid/corrupt
ordering, exact shared determinate and indeterminate progress serialization in
REST and SSE, live-only intermediate progress and atomic terminal persistence
without Revision or disk churn, crash interruption without progress recovery,
strict malformed-progress failure without normalization and with sibling/user
isolation, stale-callback rejection, indeterminate-to-determinate and monotonic
progress transitions, service-owned 1.0 with no completion rewind, malformed
Analysis isolation, exact shared safe Failure serialization and diagnostic
concealment, one-model root/child Analysis ownership and failure isolation,
one-level-depth enforcement, published-Data-Block survival, full detachment
recomputation, absence of `AnalysisOperation`, cache materialization, and generic
Task child contracts, full slot utilization, per-user dispatch rotation,
new-user next-turn behavior, per-user FIFO tie-breaking, no preemption,
single-user FIFO, runtime-only queue identity, and
Workspace deletion cascades.

## Milestone 6: Imports and unified events

- Replace paged immediate-directory listing with one complete recursive scan
  of the authenticated user's public User File root. Return a stable flat list
  of typed files and directories whose relative paths let the client build the
  complete tree; exclude private storage, follow no links, and never truncate.
- Emit that flat list as a deterministic depth-first traversal. Within each
  directory, emit directories before files, sort names by Unicode case-folded
  value, use exact relative path as the final tie-breaker, and emit each
  directory before its descendants.
- Keep the scan consistent under the existing per-user file gate. Treat a full
  response that exceeds the shared response-safety boundary as an atomic
  `user_file_tree_too_large` failure rather than adding pagination, a
  file-count quota, or a partial-tree representation.
- Model remote sample and Data Portal downloads as `UserFileImport` resources.
- Retain existing download/provider execution logic behind the new ownership
  boundary without persisting provider credentials.
- Give `UserFileImportService` one independent runtime-only fair queue and the
  positive finite immutable `user_file_import_capacity`, defaulting to two in
  every profile with no hard-coded upper ceiling or unlimited value. Persist
  imports queued before waiting, queue on saturation, and rotate dispatch
  fairly by user while allowing one user to fill every free slot alone.
- Share only a private fair-user queue selector with Analysis scheduling. Keep
  import lifecycle, persistence, executor handles, and capacity separate; add
  no generic Task service or shared background-resource scheduler.
- Execute sample imports with cancellable async I/O and bounded blocking-file
  offloading. Execute each Data Portal import in one fresh private child process
  that does not consume Analysis capacity. Confirm cancellation only after the
  scope or process stops and staging is removed.
- Define one exact `UserFileImport` model with secret-free discriminated request,
  lifecycle, shared Progress and Failure, nullable safe publication result,
  timestamps, and Revision. Return it from source-specific `202` submissions,
  canonical detail, and the one-based created-descending import collection.
  Add canonical cancel and terminal-only delete operations with exact
  pending/confirmed, `409`, concealed `404`, and empty `204` semantics; deleting
  history never deletes published User Files.
- Fail queued or running imports as interrupted after an unclean restart and
  require an explicit complete retry.
- Replace Task events with one user-scoped event hub and `/api/events` SSE
  stream covering Workspaces, Tabs, root and child Analyses, and imports.
- Register each bounded subscriber before emitting `stream_ready`; keep
  authoritative refreshes in ordinary resource endpoints and reconcile them
  with queued events by resource Revision.
- Do not build SSE resource snapshots or replay history; enforce
  `resync_required` closure on overflow, heartbeat, request/session association,
  and logout closure.
- Remove file-import Task adapters and the old Task event stream.
- Remove generic async/process Task capacities and replace them only with the
  separate Analysis and UserFileImport settings; retain no setting aliases.

Verification: deterministic nested User File ordering, case-fold collisions,
repeated-scan determinism, progress for every background resource,
subscribe-before-refresh races, stale-refresh rejection by Revision,
slow-subscriber overflow, reconnect resync, cross-user concealment, logout
during streaming, import saturation without rejection, full-slot single-user
use, multi-user dispatch rotation, async and process cancellation confirmation,
Analysis/import capacity isolation, exact import model and endpoint responses,
interrupted import cleanup, terminal-record deletion, and published-file
survival.

## Milestone 7: API cutover and backend cleanup

- Expose the final resource hierarchy and conventional HTTP semantics.
- Expose `GET /api/storage` as a no-store strict discriminated resource:
  a positive stored limit returns `policy="quota"` with limit, used, reserved,
  and available allocated bytes; `NULL` returns only `policy="unlimited"`
  through the same service. Treat the representation as advisory and retain
  admission-time rechecking.
- Preserve one-based endpoint-specific pagination for the Analysis collection
  and tabular/result resources, while removing page parameters and page
  metadata from the complete User File collection. Do not add a universal page
  wrapper.
- Consolidate analysis requests, Results, and queries into strict discriminated
  unions with stable operation IDs.
- Remove response wrappers, `Any` response models, compatibility status codes,
  duplicate analysis endpoints, legacy current-Workspace state,
  diagnostics, obsolete non-byte quota settings, stale settings, and unused
  adapters.
- Advertise `507` only on storage-growing operations and preserve the two
  stable storage error codes in their relevant OpenAPI responses; retain no
  alias for the old conflated exception.
- Add import-direction tests so domain, services, analysis, workers, and
  infrastructure cannot import API modules.
- Regenerate and validate OpenAPI artifacts required by backend CI, while
  leaving the React migration to a separate change.

Verification: exact routes and `Location` headers, empty `204` responses,
stable `409` and `410` codes, complete unpaginated User File tree responses,
one-based Analysis and tabular pagination, exact finite and unlimited storage
representations, no-store storage responses, advisory-read/write-admission and
concurrent quota-update races, exact `507` error codes and quota-first
precedence, exact quota-detail keys and values, physical-capacity detail
omission, sanitized `422`, request-ID propagation, operation-ID stability,
cookie security declarations, typed analysis schemas, absence of removed
routes, type checking, and dead-reference scans.

## Milestone 8: Durable documentation and final proof

- Rewrite backend architecture and domain pages to describe the implemented
  ownership model.
- Update the glossary only after the new terms are true in the running system.
- Supersede the Task-service and per-user-mutation ADRs with the final Analysis
  and Workspace decisions where an ADR is warranted.
- Update settings, API reference, development/deployment runbooks, packaging
  notes, and comments.
- Archive this complete specification only after implementation and durable
  documentation agree.

Verification: backend tests and type checks, OpenAPI checks, package/runtime
checks, documentation links, Mermaid rendering, import-direction checks,
reference scans, and `git diff --check`.

## Risks

- Atomic Workspace publication and logical deletion depend on staging, live,
  and trash directories being on one filesystem. Bootstrap must enforce that
  layout, flush rename parent directories, discard interrupted staging, and
  retry incomplete trash cleanup before serving requests.
- Input reservations prevent Data Block mutation from racing active Analysis
  execution. Whole-Workspace deletion may still race completion; completion
  must re-enter `WorkspaceService` and either commit under the live aggregate's
  reservation invariant or discard unpublished output after logical deletion.
- Removing the Task database touches every analysis kind and background import;
  incomplete ownership conversion would create orphan execution state.
- Tab-to-root-Analysis ownership depends on `Tab.analysis_id` remaining the only
  durable Tab association, while child ownership depends only on the child's
  `parent_analysis_id` naming a live root. Adding reverse pointers or listing
  raw Analysis directories as live resources would recreate split-brain and
  orphan states.
- A mutable Workspace escaping `WorkspaceService` would recreate lost-update
  and thread-lifetime races even in a single process.
- Backend-only API cutover intentionally leaves the current React client
  incompatible until its separate migration.
- Existing data cannot be read through compatibility branches; any required
  conversion must be explicit, offline, and removable.
