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
`/health`, and shut down its process tree. Run macOS signature verification
again after this probe: the shared launcher disables Python bytecode writes so
the packaged runtime must not mutate the sealed application resources.

`LDACA_BACKEND_RUNTIME` may point to one complete alternate manifest root for
testing. It is not a partial path override and is never silently ignored.

## Desktop CI

`.github/workflows/desktop-build.yml` is the single reusable Windows and macOS
packaging workflow. The release workflow invokes it once per platform after
version validation. Backend Ruff, Ty, and Pytest gates belong to backend CI;
desktop CI retains only supervisor, bundle, and packaged-runtime checks.

macOS builds upload Tauri's generated `*.dmg` directly. Windows builds upload
the generated MSI. Release publication additionally requires the release tag
and the checked-out build ref to resolve to the same commit.

The local macOS build command sets `CI=true` only for Tauri bundling. Tauri
then uses its built-in non-GUI DMG path instead of Finder AppleScript layout,
which makes local and hosted builds deterministic without a custom DMG script.
