# Backend Workspace Architecture

## Service Boundary

`WorkspaceService` is the sole residency and mutation authority. It maintains
one asynchronous gate per user, allowing different users to proceed
concurrently while serializing one user's loads and writes. It may retain one
resident Workspace per user, subject to a global LRU and idle bound. A request
for another Workspace uses a detached load and never changes residency.

Routes and completion handlers use function-scoped read or mutation contexts.
Response models are materialized before the context releases its gate. Remote
provider calls, process execution, SSE, and response streaming occur outside
the gate.

## Aggregate And Store

`domain.workspace.Workspace` owns the live Data Block graph. A live `Node`
contains a Polars `LazyFrame` and resolved parent objects. The aggregate does
not serialize itself or know about HTTP.

`WorkspaceStore` is the only snapshot-format boundary. It validates the full
envelope and plans, constructs unattached nodes, resolves parents, rejects
invalid or cyclic graphs, and publishes the aggregate only after validation.
Plan generations are replaced before `metadata.json`, whose complete graph and
next Revision are the commit point.

## Mutation And Deletion

HTTP mutations use `If-Match` against a strong Workspace Revision. Completion
handlers may reload and retry an idempotent mutation once after conflict.
Cancellation does not abandon a persistence thread.

Deletion is coordinated with Task ownership: active execution or completion
prevents deletion; terminal Workspace Tasks are removed before the directory
is atomically hidden as a tombstone. Archive import validates, relocates, and
loads a hidden staged Workspace before making it discoverable.

User File and archive behavior is described in
[Files and Storage](../../domain/files-and-storage.md).
