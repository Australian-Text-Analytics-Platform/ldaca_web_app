# Desktop Architecture

Tauri is a native supervisor around the same React frontend and FastAPI
backend. Rust owns runtime discovery, the local child process, native folder
selection, native downloads, signed application updates, and shutdown. Python
owns Data Root validation, persistence, and Runtime switching.

## Runtime Contract

`runtime-manifest.json` is the sole packaged Python layout contract. It records
target platform, Python selector and ABI, backend lock provenance, and portable
relative interpreter, Python-home, and site-package paths. Rust validates the
complete manifest and never recursively guesses a runtime.

```mermaid
sequenceDiagram
    participant App as Tauri application
    participant Runtime as Packaged Python runtime
    participant Backend as FastAPI child process
    participant Webview

    App->>Runtime: validate runtime-manifest.json
    App->>Backend: launch with port zero and private startup record
    Backend->>Backend: enter ASGI lifespan
    Backend-->>App: publish live port, identity, and version
    App->>App: validate startup identity, version, and loopback address
    App->>Webview: show window
    Webview->>App: request current backend URL
    App-->>Webview: return live URL from managed state
    Webview->>Backend: check liveness and Data Root state
    alt Runtime unconfigured or recoverable error
    Webview->>App: open native directory picker
    App-->>Webview: selected path or cancellation
    Webview->>Backend: PUT /api/data-root
    Backend->>Backend: probe, initialize, then persist
    end
    Webview->>Backend: check readiness
    Webview->>Webview: mount authentication and Workspace consumers
    Webview->>App: close request
    App->>Backend: bounded process-tree termination
    App-->>Webview: allow window close
```

At startup, Tauri launches the backend with port zero and a private startup
record, waits for ASGI control-plane liveness, validates process identity and package version,
installs the assigned URL in managed Rust state, and only then shows the window.
The frontend connection gate obtains that URL through `get_backend_url`,
configures the generated client, checks `/health/live`, obtains
`/api/data-root`, and verifies `/health/ready` before mounting authentication
or Workspace consumers. Reloading repeats IPC discovery, so a
stale JavaScript value cannot select an old backend port.

Each desktop process owns only its own backend child. The backend parent
watchdog exits if that desktop process disappears, so multiple desktop
instances can run against the same Data Root without a shared PID record or
cross-instance process cleanup.

The packaged backend runs with Python bytecode writes disabled. Python may use
bytecode included before signing, but it must not add or update `__pycache__`
content inside the sealed application bundle at runtime.

The supervisor owns `starting`, `live`, `failed`, and `stopped` process states.
It never restarts the child for a Data Root change.

The main window remains hidden until backend liveness. If runtime resolution or
backend startup fails, Tauri schedules a native
error dialog without blocking setup and exits after the user acknowledges it.
This keeps startup failures visible even though the webview is not yet usable.

## Native Boundaries

Backend connection discovery has one frontend gate and two runtime adapters.
Browser builds retain the existing environment, runtime `basePath`, local
development port, and same-origin rules without importing or invoking Tauri.
Desktop builds dynamically load the Tauri API, treat `get_backend_url` as the
source of truth, and retry both discovery and health checks with bounded
backoff. Rust does not inject JavaScript or guess a fixed backend port.

The native directory picker returns only a selected path. The webview submits
that path to `PUT /api/data-root`; acceptance comes only from the Python
backend's filesystem probe and successful Runtime initialization. A generation
change remounts application providers and caches. The current notarized build
is not App-Sandboxed, so this native selection plus the child-process probe is
the supported macOS access model. Security-scoped bookmarks and Mac App Store
sandbox support are outside this contract.

Page zoom is owned by Tauri. The desktop shell leaves the webview at its default
100% scale and enables Tauri's platform zoom shortcuts. On macOS and Linux, the
injected shortcut handler requires the main webview's explicit
`core:webview:allow-set-webview-zoom` capability. Wordflow does not add custom
zoom controls or persist zoom state.

Debug desktop builds allow both the fixed Vite development origin and the
platform's packaged Tauri origin through backend CORS, so `tauri dev` and a
packaged debug application use the same supervisor. Release builds allow only
the packaged Tauri origin.

Native downloads accept a relative backend API path and safe filename, reject
redirects, stream to a temporary file, and publish without replacement. The
webview cannot supply an arbitrary URL or privileged headers.

## Application Updates

The official Tauri updater is the only application-update path. Rust owns the
signed update resource and the complete check, download, install, and restart
lifecycle. The native application menu exposes **Check for Updates…** as the
sole control. Checks are manual; application startup performs no update request
and creates no updater window. Rust applies a 15-second request timeout and
uses standard operating-system dialogs for the up-to-date result, errors, and
the install confirmation. The main React application and web deployment have
no updater UI, state, dependencies, or permissions.

```mermaid
sequenceDiagram
    participant Menu as Native application menu
    participant Rust as Rust updater owner
    participant Dialog as Native system dialog
    participant Plugin as Tauri updater plugin
    participant Release as GitHub Release

    Menu->>Rust: request check
    Rust->>Plugin: check with timeout
    Plugin->>Release: fetch latest.json
    Release-->>Plugin: version, platform URL, signature
    Plugin-->>Rust: newer signed release metadata or none
    alt No update or check error
        Rust->>Dialog: show native result
    else Newer release
        Rust->>Dialog: ask to download and restart
        Dialog-->>Rust: user accepts
        Rust->>Plugin: download and install
        Plugin->>Release: stream platform updater artifact
        Plugin->>Plugin: verify embedded public key signature
        Plugin-->>Rust: installed
        Rust->>Rust: restart application
    end
```

The updater public key and endpoint are compiled into Tauri configuration.
The private updater key exists only as GitHub Actions secrets. GitHub Releases
retain the versioned installers and updater packages; neither the FastAPI
backend nor a Workspace stores application versions. Release tags and assets
are treated as immutable after publication.

Main-window close requests trigger bounded process-tree termination before the
window closes. Unix uses a process group with escalation; Windows terminates
the child tree.
