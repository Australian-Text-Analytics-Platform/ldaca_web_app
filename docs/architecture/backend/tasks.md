# Backend Task Architecture

## Definitions And Execution

`TaskService` is the sole Task authority. Each `TaskDefinition` declares a
stable kind, schema versions, strict request/result/preferences models,
executor strategy, storage limits, Artifact ownership, and optional idempotent
completion and cleanup hooks.

Executors own only process futures, PIDs, cancel scopes, and asynchronous
handles. Process workers configure their environment before importing heavy
dependencies, consume immutable input snapshots, report bounded progress, and
write large outputs under declared Task roots.

## Persistence And Recovery

Task state is stored as transactional SQLite rows with indexed owner,
Workspace, and parent identities. Durable boundaries include creation,
execution start, result/completion handoff, cancellation request, terminal
transition, preference update, and deletion. Progress between those boundaries
may be slightly stale after a crash.

Startup validates the current schema, quarantines invalid records, marks
orphaned queued/running Tasks interrupted, and replays an idempotent completion
whose Result was persisted but not applied. Generic automatic requeue is
absent because providers and Artifact writes are not universally idempotent.

## Results, Artifacts, And Events

Public Task resources omit request payloads and private paths. A successful
Analysis exposes a discriminated typed Result; declared Artifacts are projected
to stable download resources. Completion commits any Workspace mutation before
the Task becomes successful.

SSE subscription and the initial user snapshot are captured under the same
service lock. Events carry a monotonic Revision and timestamp. A slow bounded
subscriber receives `resync_required` and reconnects for a fresh snapshot;
historical replay is not promised.
