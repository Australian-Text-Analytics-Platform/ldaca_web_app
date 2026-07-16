# Backend HTTP API Architecture

## Router Responsibilities

Routes declare HTTP contracts, resolve the current identity and runtime-owned
service, validate HTTP-only preconditions, call a narrowly scoped service
operation, shape headers/status, and return strict materialized resources.
Business workflows, storage, providers, Polars transforms, and resource
lifecycle transitions do not live in `api/`.

Operation IDs are explicit and stable. The exact method/path/operation set is
asserted against generated OpenAPI and listed in the
[backend API reference](../../reference/backend-api.md).

```mermaid
flowchart LR
    API["/api"] --> SESSION["session and authentication"]
    API --> STORAGE["current-principal storage"]
    API --> EVENTS["unified events"]
    API --> FILES["user-files"]
    API --> SAMPLES["sample collections"]
    API --> PORTAL["data portal"]
    API --> IMPORTS["user-file-imports"]
    API --> WORKSPACES["workspaces"]

    SAMPLES --> SAMPLE_IMPORT["collection imports"]
    PORTAL --> PORTAL_IMPORT["search, featured, imports"]
    IMPORTS --> IMPORT_CANCEL["read, list, cancel, delete"]

    WORKSPACES --> OPEN["explicit open state"]
    WORKSPACES --> ARCHIVE["archive"]
    WORKSPACES --> NODES["nodes<br/>Data Block resources"]
    WORKSPACES --> TABS["tabs"]
    WORKSPACES --> ANALYSES["analyses"]

    NODES --> ROWS["rows"]
    NODES --> PREVIEWS["creation and annotation previews"]

    TABS --> CURRENT["current root Analysis"]
    ANALYSES --> RESULT["result, query, and Artifacts"]
    ANALYSES --> CHILDREN["direct Child Analyses"]
    ANALYSES --> CANCEL["cancel"]
```

## Security

Hosted protected operations declare the `wordflow_session` cookie through
OpenAPI security. Desktop mode resolves its process identity through the same
dependency without issuing a cookie. Unsafe requests require an exact allowed
Origin and `X-CSRF-Token`; provider callbacks use their own one-use validation.

CORS and trusted Host rules are explicit settings. No Wordflow API route accepts
bearer authentication or query-string credentials; provider adapters may use
their own server-side credentials. Cross-user Workspace, Analysis, and User
File Import lookups are concealed as not found.

## Resources And Errors

The API uses direct typed resources, standard creation/deletion status codes,
relative `Location` headers, one-based pagination only for Analysis, row, and
retained-import collections, strong Workspace ETags, and typed media for
downloads and SSE. User Files return one complete deterministic tree rather
than a paginated directory protocol.

Framework-neutral errors are mapped to `ApiError` with a stable code, safe
message/details, and request ID. Validation never echoes Pydantic inputs,
bodies, credentials, host paths, or internal exception text.

Blocking filesystem and Polars work uses the runtime AnyIO limiter with
non-abandoned cancellation. Workspace gates are released before remote calls,
process work, streams, or `FileResponse` delivery.
