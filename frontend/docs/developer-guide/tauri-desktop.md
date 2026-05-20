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
- `src/main.rs`: backend runtime resolution, backend launch, native commands,
  and shutdown.

The staged backend runtime is created outside Tauri by root packaging scripts.

## Backend Runtime Resolution

`main.rs` first checks explicit environment overrides:

- `LDACA_BACKEND_PYTHON`
- `LDACA_BACKEND_RUNTIME`
- `LDACA_BACKEND_LAUNCHER`

Without overrides it looks for `backend-runtime/runtime-manifest.json` in
bundle resources, executable-relative resource folders, and debug development
fallbacks. The launcher prefers the managed Python interpreter shipped inside
the runtime instead of venv stub launchers because packaged venv metadata can
contain build-machine paths.

## Backend Launch

At startup Tauri:

1. reaps stale backend pids from previous crashed runs,
2. chooses an available port from `8001` to `8010`,
3. injects `window.__BACKEND_URL__` and `window.__BACKEND_PORT__` into the
   webview,
4. launches `python -m ldaca_wordflow.cli --backend`,
5. sets runtime environment variables for Python relocatability,
6. records a pidfile,
7. lets the React app perform `/health` polling.

On Unix, the backend is launched in its own process group. On Windows, it is
launched in a new process group without a visible console in release builds.

## Native Commands

`get_backend_url` returns the injected backend URL.

`download_to_downloads` streams a backend URL directly to the user's Downloads
folder with Rust `reqwest`. This avoids large response bodies crossing the
WebView/Tauri IPC boundary, which is unreliable for large downloads on some
Windows setups.

## Shutdown

Close requests are intercepted once. Tauri prevents immediate close, shuts down
the backend in a background thread, deletes the pidfile, then closes the
window. Unix sends SIGTERM to the process group and escalates to SIGKILL after
a timeout. Windows uses `taskkill /F /T` to terminate the process tree.
