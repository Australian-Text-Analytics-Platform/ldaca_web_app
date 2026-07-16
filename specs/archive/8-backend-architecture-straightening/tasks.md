# Backend Architecture Straightening Tasks

Status: completed
Completed: 2026-07-16

## Design

- [x] Establish backend-only scope and leave analysis algorithms unchanged.
- [x] Prefer complete affordable recomputation over caches, checkpoints,
      shared partial results, or incremental repair while preserving all
      correctness and capacity boundaries.
- [x] Establish a self-contained Workspace-folder boundary.
- [x] Keep Workspace folders under `data_root/workspaces/`.
- [x] Make the filesystem the sole durable Workspace catalogue and put exactly
      one owner in a strict deployment-only `access.json` beside each
      Workspace; store no Workspace row or mapping in SQLite.
- [x] Derive every Workspace collection from a fresh bounded filesystem scan;
      use no catalogue cache, watcher, TTL, per-user pointer, or open-registry
      discovery projection.
- [x] Isolate corrupt scanned folders individually: omit and log them without
      blocking valid siblings, fail known direct access explicitly, and retain
      deletion and quota attribution when `access.json` is valid.
- [x] Create direct and imported Workspaces closed with `201` and `Location`;
      require explicit open and provide no implicit-open flag or side effect.
- [x] Exclude collaboration, roles, memberships, invitations, CRDTs, presence,
      and WebSockets.
- [x] Establish one authoritative in-memory object per active Workspace.
- [x] Use one server-ordered concurrency contract for every narrow Workspace
      command; keep Revisions internal and require no mutation preconditions.
- [x] Replace operation strings with typed derivation provenance.
- [x] Preserve descendant-valid deletion through derivation composition, but
      reject the complete mutation with `data_block_in_use` when any affected
      Data Block has an active Analysis input reservation.
- [x] Make Analysis own request, execution lifecycle, Result, Artifacts,
      integrity, and any child Analyses.
- [x] Use one Analysis model for roots and explicit user-requested,
      independently observable child computations such as detachment. Give
      children a non-null root `parent_analysis_id`, allow zero or many direct
      children but no grandchildren, isolate child and root failure, transfer
      published Data Blocks to independent Workspace ownership, and keep Result
      queries as reads. Add no `AnalysisOperation` resource.
- [x] Remove cache/materialization tasks, shared partial results, generic child
      task submission, `materialization_task_id`, and materialized fast paths;
      recompute the complete detachment output when necessary.
- [x] Remove the generic public/durable Task domain from the target model.
- [x] Execute each admitted Analysis in one fresh `spawn` child process behind
      one positive finite deployment-configured global host-safety gate. Give
      the setting no hard-coded upper ceiling or unlimited value, keep saturated
      Analyses durably queued and observable without rejection, and add no
      queue-count or per-user execution limit. Use the same default of two in
      every profile, do not derive it from CPU count, and leave native-library
      threading automatic rather than partitioning or lending cores. Put
      capacity and runtime-only queues in a private Analysis scheduler, keep
      only launch entries, eventual process handles, and validated IPC in the
      private executor, isolate cancellation and native failure per Analysis,
      and add no reusable process pool, Analysis thread mode, per-kind CPU
      weight, fallback executor, or generic Task scheduler.
- [x] Schedule queued Analyses through work-conserving per-user round robin.
      Fill every available slot, rotate one turn per active user, select that
      user's oldest Analysis by creation time then ID, give a newly active user
      a turn before the most recently dispatched user repeats, and never preempt
      running work. Add no weights, priorities, reserved execution slots,
      per-user concurrency limits, durable queue state, or portable scheduling
      identity; let single-user mode reduce to FIFO.
- [x] Define public `running` as executor admission, including process startup,
      with `started_at` equal to admission time. Register one private launch
      entry before releasing the Workspace gate, serialize launch and cancel
      there, suppress launch when cancellation wins, fail isolated startup with
      `analysis_start_failed`, and add no public `starting`, retry, or fallback.
- [x] Make Tab a first-class Workspace-owned resource created durably as soon as
      the client adds it, including before any Analysis is submitted.
- [x] Persist the analysis kind already determined by the frontend function at
      Tab creation, return it for reconstruction and grouping, and expose no
      kind-change operation.
- [x] Require exactly `kind` and `name` in `TabCreate`; generate the UUID, null
      Analysis association, initial timestamps, and Revision 1 on the backend,
      with no default-label or per-kind numbering state.
- [x] Reject a request whose discriminator differs from the Tab kind with
      side-effect-free `409 analysis_kind_mismatch` before input lookup,
      Analysis creation, persistence, or event publication.
- [x] Make the UUID the sole Tab identity and allow duplicate display names
      without exact, case-folded, or Unicode-normalized uniqueness checks or
      name-conflict responses.
- [x] Use one `TabName` validator across create, rename, persistence, and import:
      strip outer Unicode whitespace, require 1–500 code points, reject Unicode
      `Cc` controls, and preserve all other content without normalization.
- [x] Treat rename to the same post-trim name as `200 Tab` with no Tab or
      Workspace write, timestamp/Revision change, or SSE event; commit only a
      genuinely changed label.
- [x] Return every Tab unpaginated by immutable `created_at` ascending and Tab
      ID ascending; persist no position or active Tab and expose no reorder
      endpoint.
- [x] Return `GET .../tabs` as a raw `list[Tab]` with exact identity, kind,
      label, association, timestamp, and Revision fields; use `[]` when empty
      and add no wrapper, pagination, kind filter, or kind-specific alias.
- [x] Treat strict, atomically published Tab records as the only public shape.
      Add no `CorruptTab`, partial collection, compatibility reader, repair, or
      deletion bypass; return isolated `500 tab_corrupt` if persisted storage
      is invalid while preserving its bytes and sibling availability.
- [x] Delete an existing Tab with empty `204` and the normal Analysis-detach
      cleanup rule; return side-effect-free `404 tab_not_found` for a missing or
      repeatedly deleted Tab, while keeping clear Analysis idempotent for an
      already-empty existing Tab.
- [x] Keep unsubmitted analysis drafts entirely in frontend-local state. Add no
      backend draft field, persistence, route, autosave, Revision change, or SSE
      event; accept one complete strict request only when Run is invoked.
- [x] Reject Run with `409 analysis_input_missing` before Analysis creation when
      a requested Data Block is absent; leave the Tab empty and commit no
      Revision, timestamp, persistence, or event side effect.
- [x] Keep the Tab name on the Tab and store no label, title, or name on an
      Analysis; remove the one-Analysis-equals-one-Tab shortcut.
- [x] Give each Tab zero or one current root Analysis through the Tab's nullable
      `analysis_id` as the sole durable Tab association; store no reverse Tab
      pointer and reject duplicate root references. Relate direct child Analyses
      only through their non-null root `parent_analysis_id`.
- [x] Require explicit clear before another submission. Clear atomically makes
      the Tab empty, permits immediate resubmission, and leaves cancellation and
      physical deletion of the old unique Analysis to internal cleanup.
- [x] Give Analysis a dedicated `POST .../{analysis_id}/cancel` lifecycle
      operation. Cancel queued work synchronously with an atomic `cancelled`
      commit, equal request/finish timestamps, null start time, retained queued
      Progress, one terminal event, no process, and `200 Analysis`; let its race
      with dispatch resolve through the Workspace gate. For running work,
      persist the first request, return `202 Analysis` until termination is
      confirmed, make repeated pending requests side-effect-free, return
      `200 Analysis` once cancelled, reject succeeded or failed Analyses with
      `409 analysis_not_cancellable`, and keep cancellation distinct from clear.
- [x] Resolve completion versus cancellation by the first valid terminal
      transition committed through the Workspace gate. Preserve the cancellation
      request timestamp even when success wins and discard every losing callback
      without priority, grace, rollback, rewriting, or another lock.
- [x] Store no creator, owner, or user identity on a Tab or Analysis; both are
      equal Workspace-owned resources governed by Workspace authorization.
- [x] Persist no Analysis presentation preferences; use explicit side-effect-
      free Result queries and leave temporary display state to the frontend.
- [x] Return one complete `Analysis` model, including the immutable request and
      lifecycle metadata, from creation, current-Tab reads, direct reads, and
      valid paginated collection items. Keep large computed data in separate
      resources and add no summary/detail split or hydration endpoint.
- [x] Give that model exactly ID, nullable parent Analysis ID, immutable
      discriminated request, state, progress, nullable cancellation request
      time, nullable safe failure, integrity, created/started/finished
      timestamps, and Revision. Validate state-dependent nullability, require
      null parent only for roots and a root ID for children, and omit duplicated
      kind, resource context, names, identity, `modified_at`, availability,
      status, and link fields.
- [x] Replace parallel terminal error fields with shared nullable
      `Failure {code, message}` for Analysis and UserFileImport. Keep stable
      lowercase code and safe bounded message,
      separate it from HTTP `ApiError`, map unexpected exceptions generically,
      and expose no internal diagnostics, arbitrary details, request ID, or
      retry flag.
- [x] Share one exact Progress model across Analysis and UserFileImport REST and
      SSE: nullable 0.0–1.0 fraction plus nullable safe
      500-code-point message. Represent indeterminate work with null, queued at
      0.0, success at 1.0, retain failure/cancellation progress, and add no
      counts, units, phases, substeps, or kind-specific variants.
- [x] Keep intermediate Progress in memory and SSE only, with no JSON write,
      durable Revision, or Workspace timestamp change. Persist queued Progress
      at creation and final Progress with terminal state, accept intermediate
      loss before interrupted restart reconciliation, and add no throttle,
      timer, journal, sidecar, or periodic persistence job.
- [x] Reject malformed Progress without clamping, truncation, coercion, or silent
      discard. Fail only the owning resource with `progress_invalid`, request
      its executor termination, preserve sibling/user isolation, and continue
      ignoring callbacks for already-terminal or absent resources as stale.
- [x] Allow queued zero to become indeterminate only on the first running
      report, allow null to become numeric, then require non-decreasing numeric
      fractions with no return to null. Permit equal-value message changes and
      reserve 1.0 for atomic durable success; treat premature completion or
      regression as `progress_invalid`.
- [x] Derive shared input reservations from queued and running Analysis records
      and immutable input IDs. Allow concurrent readers, reject every Data
      Block mutation whose complete affected set intersects a reservation with
      `data_block_in_use`, and persist no separate lock, counter, or sidecar.
- [x] Retain reservations through Workspace close, cancellation requests, and
      detached cleanup after clear or Tab deletion. Release them only with a
      durable succeeded, failed, or cancelled transition; let whole-Workspace
      deletion use its aggregate cancellation-and-removal lifecycle.
- [x] Define dispatch-time input snapshotting without permanent input copies.
      Verify reservations and snapshot under the Workspace gate after capacity
      selection, treat an unexpectedly missing reserved input as isolated
      `analysis_input_missing` storage-integrity failure with null start time
      and no process, assert the invariant again before completion publication,
      and clean every temporary snapshot path.
- [x] Keep Analysis reads side-effect-free. Return current integrity without
      lifecycle mutation, cancellation, Revision change, or event publication;
      preserve completed history as invalid when an input is deleted after its
      reservation is released.
- [x] Represent a corrupt Analysis as a minimal typed collection item after
      valid Analyses, isolate healthy Tabs, and keep the corrupt item deletable
      through the normal Analysis endpoint without parsing its record.
- [x] Define cancellation-aware Analysis and Workspace deletion.
- [x] Make Workspace deletion an immediate logical `204` removal through an
      atomic rename into `.trash/`; expose no deleting state, Task, or SQLite
      tombstone and retain ownership through `access.json` until cleanup.
- [x] Model remote downloads as retained `UserFileImport` resources.
- [x] Give UserFileImport an independent runtime-only work-conserving fair
      scheduler and positive finite `user_file_import_capacity`, defaulting to
      two in every profile with no hard-coded ceiling or unlimited value.
      Persist queued before waiting, allow one user to fill all free slots,
      rotate users under contention, and share only the private fair-queue
      selector with Analysis scheduling.
- [x] Keep import lifecycle, persistence, capacity, and executors separate from
      Analysis and generic Tasks. Use cancellable async I/O for samples, one
      fresh private process for Data Portal imports, confirmed-only cancellation
      after staging cleanup, and the shared Progress, Failure, and SSE contracts.
- [x] Give UserFileImport one exact secret-free request/lifecycle/result model,
      source-specific `202` creation with canonical Location, one-based
      created-descending collection, identical detail, confirmed cancellation,
      terminal-only deletion, concealed absence, and published-file survival.
- [x] Keep one-based typed pagination for Analysis collections and tabular or
      result data, but return the complete User File tree input as one stable
      unpaginated flat collection with no partial-page semantics.
- [x] Fail an exceptionally large complete User File collection at the shared
      response-safety boundary instead of truncating it or introducing a
      file-count quota.
- [x] Order the complete User File collection by deterministic depth-first
      traversal, with directories before files, Unicode case-folded names, and
      exact relative paths as tie-breakers.
- [x] Use one user-scoped SSE interface for all background resources.
- [x] Preserve user-level fault isolation and strict corruption boundaries.
- [x] Persist every principal through the same SQLite `users` table, including
      the fixed single-user principal.
- [x] Add nullable `storage_quota_bytes` with a 30 GiB database default and a
      positive-or-null constraint; let `NULL` uniformly mean unlimited and
      explicitly assign it to the single-user row.
- [x] Use the same `QuotaService` and storage-admission path in every profile;
      make unlimited quota admission a no-op while retaining shared physical
      storage and process-safety checks.
- [x] Derive finite quota usage from user-owned durable files plus process-local
      reservations under one per-user admission gate; persist no usage ledger
      or counter, reload the SQLite limit, and recheck growth before
      publication.
- [x] Measure finite quota using filesystem allocation for regular files and
      directories with a one-allocation-unit floor per entry, fail hosted
      startup when the Data Root cannot report both metrics reliably, and
      retain no logical-size fallback.
- [x] Expose one no-store current-principal `/api/storage` resource through the
      same service: return a fresh snapshot for a positive limit and only
      `policy="unlimited"` for `NULL`, while keeping write admission
      authoritative.
- [x] Cache no quota assignment; observe a committed SQLite update on the next
      status/admission check and block only positive growth when a new limit is
      already exceeded.
- [x] Use HTTP `507` with distinct `storage_quota_exceeded` and
      `storage_capacity_exceeded` codes, check finite quota before shared
      capacity, conceal physical-storage details, and keep process-memory
      capacity on `503 backend_capacity_exceeded`.
- [x] Return exactly limit, durable usage, existing reservations, and requested
      growth in quota-error details; omit details entirely from shared
      physical-capacity errors.
- [x] Protect hosted process memory with one global open-Workspace serialized-
      snapshot byte capacity that fails without eviction; keep single-user
      modes free of an aggregate open-Workspace cap.
- [x] Allow multiple explicitly open Workspaces per user through transient
      per-ID slots that own one gate and at most one loaded aggregate.
- [x] Hold the slot gate across open so concurrent callers wait and reuse the
      loaded aggregate, while a failed load may be recomputed completely; use
      no shared future or public opening state.
- [x] Keep `WorkspaceService` as the mutation and residency authority rather
      than introducing a separate Workspace coordinator class.
- [x] Fail non-terminal root or child Analyses and UserFileImports as
      interrupted after restart; root Analysis retry explicitly clears its Tab
      first, then creates a new resource and repeats the complete computation.
- [x] Sort Workspaces by `modified_at` descending and ID ascending, using a
      required domain timestamp updated by user-visible durable changes rather
      than filesystem metadata, progress-only updates, or runtime/read activity.
- [x] Give every directly created or imported Workspace one new publication
      instant for both timestamps; validate but do not retain archived
      timestamps when import creates its new Workspace ID.
- [x] Sort Analyses by immutable `created_at` descending and Analysis ID
      ascending; do not persist positions, a reorder endpoint, or an ordering
      sidecar.
- [x] Use archive export/import as the only individual-Workspace relocation
      contract; do not discover or register directly copied raw folders.
- [x] Serialize every Workspace-contained mutation through one Workspace gate;
      do not introduce separate locks for root or child Analyses.
- [x] Keep SSE as a live event transport only; subscribe before authoritative
      REST refresh, reconcile by Revision, and retain no snapshot or replay
      state in the event hub.
- [x] Make Workspace open and close explicit process-local operations; remove
      automatic loading, eviction, resident limits, and backend-selected
      current-Workspace state.
- [x] Accept close while work is non-terminal, reject new external work, let
      already-queued root and child Analyses continue internal dispatch, let all
      admitted work finish, and remove the drained entry from the final terminal
      handler without deleting its history.
- [x] While closing, permit observation and cancellation/deletion of existing
      work plus lifecycle controls; reject new work and content mutations with
      `workspace_closing`, then return `workspace_not_open` after final close.
- [x] Make explicit open cancel deferred close; serialize open against final
      completion so one existing or normally reloaded entry remains.
- [x] Expose `closed | open | closing` as derived Workspace `runtime_state` in
      the one Workspace resource and SSE without persisting it as portable
      content.
- [x] Use one lightweight Workspace model for collection and individual reads
      while closed; keep graph and Analysis child resources open-only and
      remove summary/detail and nullable-graph alternatives.
- [x] Permit only metadata reads and deletion against an existing closed
      Workspace; require open state for updates, export, graph, Analyses, and
      their child resources, while collection-level import creates a new closed
      Workspace.
- [x] Model open state as the singleton `/workspaces/{workspace_id}/open`
      subresource with idempotent `PUT` and `DELETE`; keep no load/unload or
      selected/current-Workspace compatibility endpoints.
- [x] Keep active browser/Tauri client coordination out of the backend; a
      future single-editing-window experience is a non-authoritative frontend
      courtesy, not an editing lease or correctness boundary.
- [x] Do not distinguish stale-write policies by command type; execute every
      authorized request through the gate and commit it when current domain
      state permits it.
- [x] Use “command” only as the name of a mutation intent handled by an explicit
      typed service method; introduce no command objects, bus, dispatcher,
      CQRS framework, or event-sourced command log.
- [x] Define graceful shutdown as bounded infrastructure interruption. Use one
      positive finite `shutdown_grace_seconds` defaulting to 10, reject new
      work, stop dispatch, fail queued resources as interrupted, terminate
      running executors concurrently, preserve success and previously requested
      user cancellation when they win, otherwise fail confirmed stops as
      interrupted, force-stop at the deadline, and reconcile any uncommitted
      non-terminal record on startup without resume.
- [x] Close executors before Workspace slots, event subscribers, providers,
      SQLite, and logging, while isolating each resource and user during
      termination and reconciliation.
## Implementation

- [x] Link a GitHub issue and rename the active folder to the issue-prefixed
      canonical path before implementation.
- [x] Add characterization tests and the contract/persistence inventory.
- [x] Complete runtime, request identity, errors, authentication, and lifespan
      ownership, including stopping readiness, admission closure, both scheduler
      stops, exact queued and running interruption semantics, one bounded
      shutdown deadline with force-stop, startup reconciliation, and strict
      reverse-order resource closure.
- [x] Extend the strict users schema with `storage_quota_bytes`, provision the
      single-user principal as a normal unlimited row, and default hosted users
      to 30 GiB with no legacy schema migration path.
- [x] Implement filesystem-scanned Workspace discovery and the central
      `access.json` owner boundary; remove Workspace persistence from SQLite.
- [x] Move Workspace storage to the global `workspaces/` directory with private
      `.staging/` and `.trash/` lifecycle areas.
- [x] Implement the shared filesystem-allocation `QuotaService`, finite-policy
      capability probe, process-local reservation gate, live SQLite-limit
      reads, and no-op unlimited policy separately from mode-independent
      free-space capacity, with no logical-size fallback.
- [x] Replace the conflated `StorageCapacityError` with quota and physical
      capacity domain errors and exact OpenAPI `507` responses, retaining no
      compatibility alias.
- [x] Add exact quota-detail serialization and tests, including concurrent
      limit reduction with zero additional requested growth and detail-free
      physical-capacity failures.
- [x] Implement the strict `/api/storage` union and point-in-time finite status
      scan without a cache or counter.
- [x] Implement hosted open-Workspace snapshot-byte admission and release in
      `WorkspaceService`, with no eviction and no single-user aggregate cap.
- [x] Implement transient WorkspaceService slots and the explicit per-Workspace
      open and close lifecycle.
- [x] Implement strict Workspace JSON resources and atomic publication.
- [x] Implement required Workspace timestamps, exact `modified_at` update
      boundaries, and deterministic `modified_at`-descending collection order.
- [x] Test direct creation and archive import timestamp initialization,
      including replacement of valid archived timestamps at publication.
- [x] Implement explicit plan-source bindings and relocation.
- [x] Implement typed derivations and descendant-preserving deletion, including
      complete affected-set reservation checks and atomic
      `409 data_block_in_use` rejection.
- [x] Implement strict per-resource Tab persistence and narrow collection,
      detail, create, rename, and delete service/API methods; create a Tab
      immediately from exact `TabCreate` with server-generated fields and its
      function-determined immutable kind, without requiring an Analysis or
      backend naming state; return the complete collection in deterministic
      creation order as the exact raw `list[Tab]` contract, address it only by
      UUID, allow duplicate names through the strict shared `TabName` type,
      implement normalized no-op rename without persistence/event churn, and
      persist no position, active Tab, or draft state. Publish validated records
      through the crash-safe atomic-write primitive, validate staged imports,
      and fail affected Workspace access with safe `500 tab_corrupt` rather
      than returning partial or fallback Tab data. Implement exact `204` Tab
      deletion and `404 tab_not_found` absence semantics without making clear
      Analysis non-idempotent.
- [x] Implement sole-owner `Tab.analysis_id` root validation, staged Analysis
      creation for empty Tabs from one complete kind-discriminated request,
      immutable request snapshotting, side-effect-free
      `409 analysis_kind_mismatch`, `409 analysis_input_missing`,
      `409 tab_analysis_exists`, atomic input-reservation establishment,
      one-level child-parent validation, and a live Analysis collection derived
      from Tab-referenced roots and their valid direct children.
- [x] Implement Analysis-owned lifecycle and per-Analysis persistence.
- [x] Replace generic Task execution with the lifespan-owned private Analysis
      scheduler and process executor: scheduler-owned runtime queues and positive
      finite `analysis_execution_capacity`, queued-before-wait persistence, no
      saturation rejection or hard-coded setting ceiling, the same default of
      two in every profile, work-conserving per-user rotation with deterministic
      per-user FIFO and new-user next-turn behavior, and no preemption or durable
      queue state. Give the executor one fresh `spawn` child per dispatched
      Analysis, a pre-release private launch entry, admission-time `started_at`,
      immutable snapshot and private-path inputs, validated progress and
      completion IPC, event-loop-owned service callbacks, launch-versus-cancel
      serialization, isolated `analysis_start_failed` cleanup, hard
      per-Analysis termination, and sibling crash isolation. Remove every
      public or durable `starting` state, CPU-count-derived capacity,
      backend-injected cross-library thread budget, dynamic core partition,
      process pool, retry, thread mode, fallback executor, per-kind CPU weight,
      per-user or queue-count limiter, mutable Workspace, service, database, and
      request-object path across the process boundary.
- [x] Implement the shared strict Failure serializer, state invariants, expected
      domain-error mapping, resource-specific unexpected-error mapping, and
      correlated private logging without legacy parallel error fields or raw
      diagnostic exposure.
- [x] Use the same strict valid-Analysis serializer and OpenAPI model for
      creation, current-Tab, direct-detail, and paginated collection responses;
      implement the exact field and state-invariant contract, and embed no
      Result rows, previews, Artifact bytes, presentation state, or redundant
      context.
- [x] Implement the exact Analysis cancellation endpoint, durable first-request
      timestamp, synchronous queued removal and terminal commit, dispatch race,
      private-executor signal for running work, idempotent pending/confirmed
      behavior, terminal-state rejection, SSE changes, and confirmed-only
      running-to-cancelled transition while retaining the Analysis on its Tab.
      Test queued `200` with equal timestamps, null start and no process,
      running `202`, cancellation before and after child launch, process-start
      failure, success-first and cancellation-first terminal races, immutable
      terminal state, preserved request time, released capacity, and discarded
      losing output.
- [x] Replace progress persistence with a live service-owned overlay and
      progress-only SSE events without durable Revision; persist only initial
      and terminal Progress and verify REST refresh, reconnect, close, crash,
      and terminal publication behavior.
- [x] Replace current Progress clamping and message truncation with strict shared
      validation, resource-local `progress_invalid` failure, executor stop, safe
      diagnostics, and stale-callback tests across every background-resource
      kind.
- [x] Remove worker 1.0 completion callbacks and the service's 0.99 completion
      rewind, enforce the accepted null/numeric ordering, and set 1.0 only in the
      same commit as durable success without changing computation algorithms.
- [x] Exclude user identity from strict Analysis persistence and test that
      archive round-trips retain no deployment-specific creator metadata.
- [x] Remove preference payloads, versions, models, and endpoints; move every
      server-side projection control into a strict Result-query model.
- [x] Implement one-level child Analyses with non-null root
      `parent_analysis_id`, the ordinary Analysis lifecycle/cancellation/SSE
      paths, creation through `POST .../analyses/{analysis_id}/children`,
      zero-to-many root ownership, child-private Artifact cleanup, no
      grandchildren, and atomic published-Data-Block ownership transfer that
      survives root clear. Remove every `AnalysisOperation` model, store,
      endpoint, and event branch rather than retaining an alias.
- [x] Remove materialization Task definitions, requests, result models, cache
      storage, generic child submission, materialization IDs, and detach cache
      branches; retain only complete recomputation and user-visible operations.
- [x] Implement dispatch-time Analysis input validation and execution-private
      snapshots, direct queued storage-integrity failure without process start,
      completion-time invariant failure with discarded unpublished output,
      terminal and startup snapshot cleanup, shared reservation derivation and
      terminal release, and side-effect-free Analysis integrity projection
      without any permanent input duplicate or separate lock state.
- [x] Implement `CorruptAnalysis` collection projection, safe direct-read
      failure, and pointer-only user clear without parsing invalid content.
- [x] Implement idempotent clear results, detached-executor cancellation,
      synchronous queued cancellation, running reservation retention until
      confirmed termination, late-callback rejection, unreferenced Analysis
      cleanup, immediate resubmission, and atomic-trash Workspace deletion.
- [x] Implement `UserFileImport` lifecycle persistence, its independent
      runtime fair queue and positive finite capacity setting, queued saturation,
      per-user rotation, async sample executor, fresh-process Data Portal
      executor, confirmed cancellation and staging cleanup, restart interruption,
      exact resource/list/detail/cancel/delete contracts, safe publication
      results, and shared event publication. Remove generic async/process Task
      capacity settings and retain no compatibility aliases.
- [x] Replace paged immediate-directory listing with the complete typed User
      File collection and retain endpoint-specific pagination for Analyses and
      tabular/result resources.
- [x] Add exact ordering tests for Workspace and Analysis collections plus
      the unpaginated Tab collection, nested User File trees, case-fold
      collisions, and repeated scans; prove Tab rename, Analysis transitions,
      clear, reload, and archive round-trip do not reorder Tabs. Inject an
      invalid persisted Tab and prove the complete collection fails without a
      `CorruptTab` projection or automatic rewrite, its bytes remain unchanged,
      and sibling Workspaces and users remain available. Verify existing,
      missing, and repeated Tab deletion, including current-Analysis detachment
      and side-effect-free `404` behavior.
- [x] Implement the unified user-scoped live SSE event hub and
      subscribe-then-refresh control contract, reusing the exact shared Progress
      serializer rather than defining event-only progress payloads.
- [x] Cut over the resource-oriented backend API.
- [x] Remove Task persistence, Task routes, the legacy full-replacement
      `tabs.json` sidecar, compatibility readers, response wrappers, legacy
      settings, and dead adapters.
- [x] Add import-direction and OpenAPI contract enforcement.

## Verification and documentation

- [x] Run focused tests after each ownership-boundary cutover.
- [x] Run the complete backend test suite and type checker.
- [x] Export and validate OpenAPI without entering lifespan.
- [x] Run backend packaging and supported runtime-profile checks.
- [x] Update `CONTEXT.md` and durable architecture/domain/reference/runbook docs
      to match implemented behavior.
- [x] Supersede or replace ADRs made false by the implementation.
- [x] Run `pnpm docs:links` and inspect changed Mermaid diagrams.
- [x] Run dead-reference scans and prove removed contracts have zero consumers.
- [x] Run `git diff --check`.
- [x] Archive this specification after all acceptance criteria pass.
