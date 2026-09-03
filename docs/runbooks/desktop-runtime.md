# Desktop Runtime Runbook

## Build And Stage

Use the root-owned command for local and CI packaging:

```bash
pnpm prepare:backend-runtime
```

`scripts/package_backend_runtime.py` creates a clean managed standard Python
`3.14` runtime, installs the backend without editable links, copies platform
runtime support, and writes the schema 3 `runtime-manifest.json`. The manifest
records the installed backend version and the exact `backend/uv.lock` digest in
addition to the relocatable Python layout. The locked sync honors
`backend/pyproject.toml` source overrides, so checked-out sibling packages are
built when configured and packages without an override come from their locked
registry source. Packaging fails when `pyproject.toml` and `uv.lock` disagree;
the default path does not use `--no-sources`. The manual desktop workflows
expose an opt-in `no_sources` input, defaulting to `false`. When enabled, CI
passes `--no-sources`, resolves dependencies from PyPI without `--locked`, and
refuses source distribution builds for `polars-text` and
`polars-source-utils`. This installs their Python 3.14 wheels without compiling
either Rust extension.

The packager removes Finder `._*` and `.DS_Store` metadata before signing
because HFS disk-image installation does not preserve those pseudo-files as
ordinary sealed resources. The frontend staging script validates the target,
backend version, lock digest, Python ABI, and layout, copies into a temporary
sibling directory, then replaces `frontend/src-tauri/backend-runtime` as a
whole. A previous runtime can never be merged into the replacement.

Do not set `PYTHONPATH` manually or create another desktop development runtime.
`pnpm dev:desktop` and release builds consume the same staged directory through
their explicit development and packaging profiles.

Build the local Apple Silicon application and DMG from the repository root:

```bash
pnpm build:desktop:mac
```

Routine packaging copies `frontend/src-tauri/icons/Assets.car`; it does not
compile the Icon Composer document. After changing `wordflow.icon`, regenerate
the catalog explicitly with `pnpm -C frontend compile:desktop:mac-icon` and
review both source and generated asset changes together.

Local build commands disable updater-archive generation because updater
signatures require the private key held by GitHub Actions. Release builds keep
updater generation enabled through the base Tauri configuration.

## Develop

Start the native development application from the repository root:

```bash
pnpm dev:desktop
```

The desktop Vite server owns the fixed strict origin
`http://127.0.0.1:3001`. It exits when that port is occupied and never scans for
or kills another listener. Identify the listener before stopping the intended
process:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

On Windows, use PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen
```

The loopback-only Vite server does not restrict the desktop application's
outbound access. LDaCA Data Portal traffic leaves through the supervised Python
backend.

The development command explicitly enables the Rust `dev-runtime` feature, so
the supervisor reads only `frontend/src-tauri/backend-runtime`. Packaged builds
do not enable that feature. They use `pnpm -C frontend tauri:build`, which
applies `src-tauri/tauri.bundle.conf.json` and makes Tauri embed the staged
directory as its `backend-runtime` resource. Do not invoke raw `tauri build` for
a distributable package.

## Validate

```bash
pnpm -C frontend versions:check
cd frontend/src-tauri
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Preparation and packaging must fail when the staged manifest or any declared
path is missing, absolute, escaping, corrupt, stale, or for another
version/platform/ABI. Rust also compiles the current lockfile digest into the
desktop binary and verifies the bundled manifest against it before Python
starts. After bundling, the ignored package probe must resolve the final
resource directory, import the backend and both compiled extensions, exercise
DuckDB-backed cached tokenization, launch the packaged backend without a Data
Root, verify `/health/live`, and shut down its process tree.
The cached-tokenization probe uses the built-in tokenizer so it verifies that
DuckDB's JSON support is statically linked in a clean temporary home without
downloading a model or DuckDB extension. Run
macOS signature verification again after this probe: the shared launcher
disables Python bytecode writes so the packaged runtime must not mutate the
sealed application resources.

The local Quotation spaCy model is deliberately not installed into the sealed
runtime. First use downloads model data into the OS-native
`au.edu.ldaca.wordflow` application cache and loads it by path, leaving the
signed application unchanged. An offline first use therefore fails normally
and can be retried when network access is available.

## Desktop CI

`.github/workflows/desktop-build.yml` is the single reusable Windows and macOS
packaging workflow. `.github/workflows/desktop-release.yml` invokes it manually
once per platform after version validation. Backend Ruff, Ty, and Pytest gates
belong to the root CI workflow; desktop CI retains only supervisor, bundle, and
packaged-runtime checks.

Leave `no_sources` disabled when a desktop artifact must include unpublished
local extension changes. Enable it only after the matching `polars-text` and
`polars-source-utils` versions and Python 3.14 wheels are published to PyPI.

The reusable build workflow owns all compilation and packaging. It prepares the
selected backend runtime and invokes only the packaging configuration, then:

- creates a signed MSI and updater signature on Windows;
- builds explicitly for `aarch64-apple-darwin` on Apple Silicon;
- deep-signs the embedded Python runtime and outer application with the
  Developer ID certificate;
- notarizes and staples the application;
- creates and signs the updater `.app.tar.gz` from that final application;
- creates, signs, notarizes, and staples the direct-download DMG.

The desktop release workflow does not rebuild. It downloads both build artifacts,
creates `latest.json`, and publishes the MSI, DMG, updater archives, signatures,
and manifest to the matching GitHub Release. Publication requires the release
tag and checked-out ref to peel to the same commit.

Repository Actions secrets required by this workflow are:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The matching Tauri updater public key is committed in
`frontend/src-tauri/tauri.conf.json`. Never commit the private key or its
password.

## Updater Key Rotation

Generate an encrypted updater key outside the repository and preserve its
private half in a password manager or protected operator backup:

```bash
cd frontend
pnpm tauri signer generate --ci --password '<strong password>' \
  --write-keys "$HOME/.tauri/ldaca-wordflow.key"
```

Store the complete private-key text and password as the two GitHub Actions
secrets above. Commit only the generated `.pub` text as `plugins.updater.pubkey`.
An application can verify only keys embedded when it was built, so rotation
requires a bridge release signed by the old key before later releases switch
exclusively to the new key.

## Release Acceptance

For each published version, verify the GitHub Release contains `latest.json`,
the MSI and signature, the Apple Silicon updater archive and signature, and the
notarized DMG. Open the quarantined DMG on a clean Mac, confirm Gatekeeper
acceptance, and verify startup performs no updater request and opens no updater
window. In an older signed build, choose **Check for Updates…** from the native
application menu, accept the standard system confirmation, and verify the app
downloads, verifies, installs, and relaunches into the new version. In a current
build, the same menu action must show the native up-to-date dialog. Failed checks
must show a native error dialog within the Rust-owned 15-second request timeout.

Verify the final macOS bundle is signed, notarized, and has no App Sandbox
entitlement. On a clean launch, use the recommended app-private root without a
permission prompt. Then select Documents through the native picker and verify
the Python child can create, read, write, and delete its probe file. Exercise
denial followed by reselection, revoked permission, unavailable volumes, and a
moved or deleted directory; each recoverable failure must return to folder
selection while `/health/live` remains available. Relaunch and confirm the
saved selected directory is restored.

On macOS 26 or later, visually verify the Clear Liquid Glass backplane in light
and dark Wordflow themes over light, dark, and colorful desktop content.
The titlebar and gutters around the application cards must show native glass,
while the sidebar interior, middle content card, tabbed analysis panels, graph,
data table, and startup or login card remain opaque. Text and icons directly on
the glass titlebar must use the white glass foreground, while opaque controls
retain their normal theme foreground. Exercise resize, sidebar collapse,
traffic-light controls, titlebar dragging, inactive-window state, reload, and
fullscreen. On an older supported macOS release, repeat the surface checks
against the plugin's vibrancy fallback. A forced plugin initialization failure
must retain the normal solid backgrounds. Browser deployments and the updater
window must remain opaque and visually unchanged.

Verify the packaged application reaches the Workspace after setup, then reload
the webview repeatedly and confirm each load discovers the current random-port
backend and passes the bootstrap gate. Switch the Data Root through Settings,
confirm the backend port and child PID do not change, and verify Wordflow reloads
automatically for the new `runtime_generation`. Immediately import sample data
and confirm it opens from the new root without a CSRF error. Perform an additional
reload check with Command-R on macOS and Ctrl-R on Windows. The packaged
application must never fall back to port `8001`; that port remains only the
documented split web development default.

Also exercise lifecycle interruption before accepting a desktop build. Close
the hidden/startup application while Python is still launching and confirm the
application exits without waiting for the 30-second readiness deadline, no
startup-error dialog appears after the close, and the child process tree is
gone. Repeat with a normal live application close and with application Quit;
each path must terminate only its owned backend process and leave no orphan.

Exercise all three desktop download paths: a large User File or Workspace GET,
a Data Block POST export, and a client-generated chart or table file. Confirm
each appears in Downloads without buffering backend bodies in the webview. Save
the same filename concurrently from two desktop instances and verify both files
remain with collision-free numeric suffixes. The packaged webview must have no
filesystem capability; **Show in folder** may reveal only the path returned by
the Rust saver. Repeat a representative download in the browser deployment and
confirm it still uses the browser's own download UI.
