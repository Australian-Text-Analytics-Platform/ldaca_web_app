# Tasks And Analysis

## Task Lifecycle

All background work uses the same states: `queued`, `running`, `succeeded`,
`failed`, and `cancelled`. Transitions are validated. A cancellation request is
not a cancelled Task until execution termination is confirmed.

A Task owns its identity, kind, user, optional Workspace, timestamps, progress,
safe terminal error, Result, Artifacts, Revision, and parent/child relations.
Execution handles and worker process IDs are private implementation details.

## Analysis

An Analysis is a typed Task kind. Its request is snapshotted from selected Data
Blocks before execution, so a worker never holds the Workspace mutation gate or
loads mutable client selection state. Results are typed by analysis kind and
may be queried without changing the durable computation outcome.

Presentation preferences may change how a Result is projected, but they do not
change the Analysis identity. Follow-up detachment or materialization is a Child
Task rather than an untracked side effect.

## Completion And Recovery

- Large worker outputs become declared Artifacts rather than process messages.
- A completion that changes a Workspace runs on the application event loop
  through the common Workspace mutation boundary.
- Completion is idempotent and recorded before success is reported.
- After restart, Task records without execution handles fail as interrupted;
  incomplete idempotent completions may be replayed.
- Terminal Tasks may be deleted only after owned children and Artifacts are
  handled.
