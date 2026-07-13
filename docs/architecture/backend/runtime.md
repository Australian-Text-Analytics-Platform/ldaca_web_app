# Backend Runtime

## Bootstrap And App Construction

`Settings` is loaded and validated before app construction. `create_app`
registers middleware, handlers, routers, OpenAPI metadata, health, and optional
SPA serving without allocating stateful resources. OpenAPI export therefore
does not enter lifespan or require a Data Root.

The CLI configures process logging and delegates to `server_launcher.py`. For a
desktop port-zero launch, the launcher binds and retains the socket before
constructing final settings, then publishes a private startup record only after
ASGI lifespan has succeeded.

## Lifespan Ownership

`runtime_context` uses `AsyncExitStack` and yields typed `LifespanState`. Startup
initializes and locks storage, initializes SQLite, creates the task group and
I/O limiter, constructs services, registers Task definitions, reconciles
durable Task and storage state, then starts bounded maintenance.

Requests retrieve the runtime from `request.state`. There is no settings or
service singleton and no fallback when lifespan is inactive, allowing tests to
run independent apps with separate roots in one process.

## Shutdown

The runtime stops maintenance, rejects new Task submissions, requests and
awaits cancellation within the grace deadline, closes subscribers, joins every
application Task, closes remote clients and process execution, then releases
clean resident Workspaces and the Data Root lock. Workspace shutdown does not
invent a save: every mutation commits before its gate is released.

## Process Model

The backend intentionally supports one ASGI process. Multiple Uvicorn workers
would split Workspace gates, Task subscribers, and execution handles. See
[ADR 0001](../../adr/0001-single-process-lifespan-owned-backend.md).

`GET /health` is public and reports only readiness and installed package
version. It does not claim per-component health or database latency.
