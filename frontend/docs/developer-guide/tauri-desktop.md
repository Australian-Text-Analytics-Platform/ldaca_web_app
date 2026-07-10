# Tauri Desktop

The desktop app is a native shell around the same React frontend and FastAPI
backend. Tauri owns the window, local backend process, backend runtime
location, and native file download path for large downloads.

## Build Inputs

Desktop configuration lives in `frontend/src-tauri/`:

- `tauri.conf.json`: product id, windows, CSP, bundle targets, icons, and
  `backend-runtime` resource inclusion.
- `Cargo.toml`: Rust dependencies for Tauri, plugins, Tokio, reqwest, and
  process/runtime helpers.
- `src/main.rs`: five-line native entrypoint.
- `src/lib.rs`: Tauri assembly and the single process owner.
- `src/runtime.rs`: manifest parsing and exact resource-root resolution.
- `src/backend_process.rs`: port selection, launch environment, and idempotent
  child ownership.
- `src/platform.rs`: process-tree termination, stale-pid reaping, and platform
  flags.
- `src/download.rs`: native streamed downloads and filename/path ownership.

The staged backend runtime is created outside Tauri by root packaging scripts.
`pnpm prepare:backend-runtime` is the only packaging-and-staging command used by
local desktop scripts and both platform workflows. Tauri development starts the
frontend through `pnpm dev:tauri` on the strict `127.0.0.1:3001` contract from
`tauri.conf.json`.

## Backend Runtime Resolution

`runtime.rs` first checks the one explicit runtime-root override:

- `LDACA_BACKEND_RUNTIME`

The override must contain a valid manifest; it is not silently ignored. Without
it, resolution checks the exact `backend-runtime` bundle resource,
executable-relative platform location, and debug development runtime. There is
no recursive resource scan or interpreter inference.

`runtime-manifest.json` schema 1 is the sole layout contract. The Python
packager writes portable relative `python_executable`, `python_home`, and
`site_packages` paths. Rust rejects absolute, escaping, missing, corrupt, or
unknown-schema layouts, resolves the three paths once against the selected
resource root, and passes that result to launch and package validation. Staging
copies the manifest unchanged.

## Backend Launch

At startup Tauri:

1. reaps stale backend pids from previous crashed runs,
2. chooses an available port from `8001` to `8010`,
3. injects `window.__BACKEND_URL__` into the webview,
4. launches `python -m ldaca_wordflow.cli --backend`,
5. sets `PYTHONHOME`, `PYTHONPATH`, and runtime variables from the manifest,
6. records a pidfile,
7. lets the React app perform `/health` polling.

On Unix, the backend is launched in its own process group. On Windows, it is
launched in a new process group without a visible console in release builds.
Ordinary process environment remains available to backend settings. Staged
`.env`, `.env.desktop`, launcher-path, and interpreter-path compatibility
contracts are not parsed; only `LDACA_BACKEND_RUNTIME` can select another
complete manifest root.

## Native Commands

`get_backend_url` returns the injected backend URL.

`download_to_downloads` streams a backend URL directly to the user's Downloads
folder with Rust `reqwest`. This avoids large response bodies crossing the
WebView/Tauri IPC boundary, which is unreliable for large downloads on some
Windows setups.

The webview exposes only the live opener, dialog, and downloads-folder
filesystem permissions. Native commands perform backend HTTP streaming and
window setup directly, so no JavaScript HTTP plugin, global Tauri object, or
extra window/webview capability is enabled.

## Shutdown

Close requests are intercepted once. Tauri prevents immediate close, shuts down
the backend in a background thread, deletes the pidfile, then closes the
window. Unix sends SIGTERM to the process group and escalates to SIGKILL after
a timeout. Windows uses `taskkill /F /T` to terminate the process tree.

## Source And Package Validation

`cargo test` and `cargo clippy` compile without generated
`src-tauri/backend-runtime` contents. The build script suppresses resource
copying only when that ignored resource is absent; Tauri's
`beforeBuildCommand` independently rejects packaging unless the staged manifest
and all three paths are valid. Rust tests cover relocation, corrupt and missing
manifests, repeated shutdown, timeout escalation, descendant termination,
filename collisions, and a streamed HTTP download.

After bundling, macOS and Windows workflows set `LDACA_TEST_RUNTIME_ROOT` to the
final resource directory and run the ignored Rust package probe. It uses the
production manifest resolver and command-environment builder to import the
backend and both compiled extensions; CI no longer guesses a venv launcher.
