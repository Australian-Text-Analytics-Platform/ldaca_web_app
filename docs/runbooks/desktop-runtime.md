# Desktop Runtime Runbook

## Build And Stage

Use the root-owned command for local and CI packaging:

```bash
pnpm prepare:backend-runtime
```

`scripts/package_backend_runtime.py` creates a clean managed standard Python
`3.14` runtime, installs the backend without editable links, copies platform
runtime support, and writes `runtime-manifest.json`. The frontend staging
script validates and copies that complete runtime into Tauri resources without
rewriting the manifest.

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
`/health`, and shut down its process tree.

`LDACA_BACKEND_RUNTIME` may point to one complete alternate manifest root for
testing. It is not a partial path override and is never silently ignored.
