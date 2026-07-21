# Backend Background Work

## Resource-Owned Lifecycles

The backend deliberately has no generic Task layer. `AnalysisService` owns
Workspace-contained Analysis state and `UserFileImportService` owns retained
remote-import state. Each service persists its own strict resource, controls
its own transitions, and publishes through the shared `EventHub`.

```mermaid
flowchart TB
    subgraph AnalysisBoundary["Workspace Analysis boundary"]
        AS["AnalysisService"] --> WS["WorkspaceService and WorkspaceStore"]
        AS --> AR["AnalysisExecutionRuntime"]
        AR --> AQ["AnalysisScheduler"]
        AR --> AP["AnalysisProcessExecutor"]
    end

    subgraph ImportBoundary["User File Import boundary"]
        IS["UserFileImportService"] --> IR["UserFileImportStore"]
        IS --> IQ["UserFileImportScheduler"]
        IS --> IP["Async sample execution or portal process"]
    end

    AS --> EVENTS["EventHub"]
    IS --> EVENTS
    EVENTS --> SSE["GET /api/events"]
    SELECTOR["FairUserQueue"] -. "private scheduling primitive" .-> AQ
    SELECTOR -. "private scheduling primitive" .-> IQ
```

The shared `BackgroundState`, `Progress`, `Failure`, event models, and fair
queue are small value-level primitives. They do not create cross-resource
identity, persistence, cancellation, parentage, result, or cleanup ownership.

## Analysis Execution

Analysis creation commits a queued Workspace-owned record before capacity is
available. A private work-conserving scheduler rotates users under contention
and preserves per-user FIFO order. When selected, the runtime re-enters the
Workspace gate, validates reserved Data Blocks, creates an execution-private
immutable snapshot, reserves a launch entry, and atomically commits `running`.

Each admitted Analysis uses one fresh `spawn` child process. The executor owns
only its launch entry, eventual process handle, raw progress/result IPC, and
termination. It owns no durable record and cannot mutate a Workspace. Worker
functions are picklable `@process_entrypoint` functions. Progress and
completion return to the application event loop, where `AnalysisService`
strictly validates them and commits the kind-specific Result through
`WorkspaceService`. Only that terminal commit writes Progress `1.0`.

The positive finite `analysis_execution_capacity` bounds simultaneous Analysis
processes. Saturation queues rather than rejects. The backend does not inject a
native-thread limit into Polars or model libraries and does not provide thread,
pool, retry, or alternate-executor fallbacks.

## User File Import Execution

Submission durably creates a queued User File Import before it waits for the
independent `user_file_import_capacity`. Sample imports use cancellable async
HTTP I/O against the canonical sample-data repository; Data Portal download and
tabulation use one private child process. Sample files stream directly into
private staging before atomic collection publication. The backend does not
package or read a local sample-data checkout. The service owns staging, quota
reservations, atomic publication, terminal persistence, and cleanup for both
kinds.

The import scheduler uses the same fair-selection primitive as Analysis but no
shared queue, capacity slot, executor, record, or cancellation state. One
resource's failure is caught at its service boundary and cannot cancel sibling
work or another user's resources.

## Recovery And Shutdown

Runtime queues and handles are never persisted. Startup strictly loads current
Analysis and User File Import schemas and transitions retained queued/running
records to their resource-specific interrupted Failure; it never requeues,
resumes, guesses, or migrates them.

Shutdown changes readiness to `stopping`, closes both submission boundaries,
and stops both schedulers. Queued resources fail as interrupted. Analysis and
import executors terminate concurrently against the same absolute
`shutdown_grace_seconds` deadline. A success already committed remains
successful, a previously requested user cancellation follows normal confirmed
cancellation, and any other confirmed stop becomes interrupted failure. A
record that cannot commit before shutdown remains non-terminal for the same
deterministic startup reconciliation.
