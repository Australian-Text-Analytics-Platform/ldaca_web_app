# Backend Overview

Wordflow's backend is a single-process FastAPI service with one canonical
resource API. Analysis algorithms live behind the runtime and HTTP boundaries
described here.

## Layers

1. `main.py` constructs a side-effect-free FastAPI application from immutable
   settings.
2. `api/` declares routes, resolves request dependencies, and shapes HTTP
   responses.
3. `services/` owns use cases and lifespan-owned coordination state.
4. `domain/workspace/` owns the framework-neutral Workspace aggregate and
   snapshot store.
5. `analysis/` owns framework-neutral computation helpers; `workers/` owns
   picklable process entry points.
6. `infrastructure/` owns databases, providers, storage adapters, and process
   utilities.
7. `models/` contains strict public request/resource schemas; `shared/`
   contains dependency-light errors and serialization types.

Dependencies point inward: services, domain, analysis, workers, and
infrastructure do not import `ldaca_wordflow.api`. Architecture tests enforce
this direction and the absence of removed facades.

## Runtime Authorities

- `Runtime` owns the database, services, executor, event hub, task group, and
  I/O limiter for one app lifespan.
- `WorkspaceService` owns Workspace residency and every mutation.
- `TaskService` owns every durable Task record and event.
- `SessionService` and `OAuthService` own identity state and provider exchange.
- `UserFileStore` and `WorkspaceArchiveService` own their respective storage
  boundaries.

The package includes narrow vendored runtime subsets for RO-Crate tabulation
and quotation extraction. They are ordinary modules with their required data
and licenses, not nested projects or submodules.

## Further Reading

- [Runtime](runtime.md)
- [Workspaces](workspaces.md)
- [Tasks](tasks.md)
- [HTTP API](http-api.md)
- [Exact endpoint reference](../../reference/backend-api.md)
- [Settings reference](../../reference/backend-settings.md)
