# Issue 88: Unified Data Root Bootstrap And Switching

## Intent

The backend owns one process-wide Data Root across direct, browser, and Tauri
launches. A non-empty `DATA_ROOT` is authoritative and immutable. Otherwise the
backend uses versioned platform configuration or remains live and
unconfigured. Single-user clients can configure and switch roots; multi-user
deployments remain operator-managed.

## Contract

- `/health/live` reports the HTTP control plane; `/health/ready` reports the
  complete Runtime.
- `/api/data-root` is the only Data Root resource. Mutation is `PUT`, requires
  an absolute server path and same-origin change token, and completes only when
  the new Runtime is ready.
- Configuration is schema 1 `settings.json` under platformdirs identifier
  `au.edu.ldaca.text-analytics`. Tauri `backend.json` is never read or migrated.
- Root changes never copy data. They reject queued/running Analysis or User
  File Import work, drain finite requests, close event streams, replace the
  Runtime, and reconstruct the prior Runtime after failure when possible.
- The frontend gates authentication and application providers on liveness,
  Data Root state, and readiness. A Runtime generation change remounts those
  providers.
- Tauri owns only backend supervision and native directory selection. The
  Python child performs the authoritative filesystem probe.

## macOS Boundary

The supported release is Developer-ID signed, notarized, and not App-Sandboxed.
Native selection plus the child-process read/write/delete probe is sufficient
for that distribution. Security-scoped bookmarks and Mac App Store sandboxing
are deferred.
