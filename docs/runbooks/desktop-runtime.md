# Desktop Runtime Runbook

## Build And Stage

Use the root-owned command for local and CI packaging:

```bash
pnpm prepare:backend-runtime
```

`scripts/package_backend_runtime.py` creates a clean managed standard Python
`3.14` runtime, installs the backend without editable links, copies platform
runtime support, and writes `runtime-manifest.json`. The locked sync honors
`backend/pyproject.toml` source overrides, so checked-out sibling packages are
built when configured and packages without an override come from their locked
registry source. Packaging fails when `pyproject.toml` and `uv.lock` disagree;
it does not use `--no-sources`. The packager removes Finder `._*` and
`.DS_Store` metadata before signing because HFS disk-image installation does
not preserve those pseudo-files as ordinary sealed resources. The frontend
staging script validates and copies that complete runtime into Tauri resources
without rewriting the manifest.

Do not set `PYTHONPATH` manually or create a separate desktop development
runtime. `pnpm desktop:dev` and release builds use the same packaging contract.

## Validate

```bash
pnpm -C frontend versions:check
cd frontend/src-tauri
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

Packaging must fail when the staged manifest or any declared path is missing,
absolute, escaping, corrupt, or for another platform/ABI. After bundling, the
ignored package probe must resolve the final resource directory, import the
backend and both compiled extensions, launch the packaged backend, verify
`/health/live`, and shut down its process tree. Run macOS signature verification
again after this probe: the shared launcher disables Python bytecode writes so
the packaged runtime must not mutate the sealed application resources.

`LDACA_BACKEND_RUNTIME` may point to one complete alternate manifest root for
testing. It is not a partial path override and is never silently ignored.

## Desktop CI

`.github/workflows/desktop-build.yml` is the single reusable Windows and macOS
packaging workflow. `.github/workflows/desktop-release.yml` invokes it manually
once per platform after version validation. Backend Ruff, Ty, and Pytest gates
belong to the root CI workflow; desktop CI retains only supervisor, bundle, and
packaged-runtime checks.

The reusable build workflow owns all compilation and packaging. It preserves
the source-aware backend-runtime build, then:

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

Verify the packaged application reaches the Workspace after setup, then reload
the webview repeatedly and confirm each load discovers the current random-port
backend and passes the bootstrap gate. Switch the Data Root through Settings,
confirm the backend port and child PID do not change, and verify application
providers remount for the new `runtime_generation`. Perform the reload check with
Command-R on macOS and Ctrl-R on Windows. The packaged application must never
fall back to port `8001`; that port remains only the documented split web
development default.
