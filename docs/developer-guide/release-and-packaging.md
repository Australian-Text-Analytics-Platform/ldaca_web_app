# Release And Packaging

## Version Stamping

Five files carry release versions and must agree before tagging:

- `pyproject.toml`
- `backend/pyproject.toml`
- `frontend/package.json`
- `frontend/src-tauri/Cargo.toml`
- `frontend/src-tauri/tauri.conf.json`

Use the root script instead of editing version strings by hand:

```bash
pnpm bump-version <semver>
pnpm check-versions
```

`scripts/check-versions.mjs` is also wired into the desktop release workflow,
so a tagged release with drift fails before desktop builds start.

## Frontend Bundle In Backend Package

The backend can serve the production frontend from package resources. The flow
is:

```bash
pnpm -C frontend build
pnpm deploy_frontend_to_backend
```

`scripts/deploy-frontend-to-backend.mjs` packages `frontend/build` into
`backend/src/ldaca_wordflow/resources/frontend/build.tar.gz` and extracts it
to the adjacent `build/` folder for local development. The backend's
`main.py` mounts that build, injects runtime globals, serves static assets, and
falls back to `index.html` for SPA routes.

## Desktop Backend Runtime

`scripts/package_backend_runtime.py` builds a relocatable Python runtime under
`dist-tauri/backend-runtime`:

- installs a managed Python version through uv,
- creates a venv under the runtime folder,
- runs `uv sync --frozen --no-dev --no-editable` from `backend/`,
- copies the platform libpython when needed,
- writes `runtime-manifest.json`.

`frontend/scripts/stage-backend-runtime.mjs` copies that runtime into
`frontend/src-tauri/backend-runtime`, rewrites manifest paths to relative
values, adjusts `pyvenv.cfg`, and adds Windows DLL search support.

The Rust launcher in `frontend/src-tauri/src/main.rs` resolves the staged
runtime from bundle resources, executable-relative fallbacks, or explicit
environment overrides. It launches `python -m ldaca_wordflow.cli --backend`,
sets `LDACA_BACKEND_RUNTIME`, `LDACA_BACKEND_PYTHON`, `PYTHONHOME`, and
`PYTHONPATH`, injects the chosen localhost URL into the webview, and owns
backend shutdown.

## CI Release Flow

`.github/workflows/release.yml` runs `node scripts/check-versions.mjs` with
submodules checked out, then delegates platform builds to:

- `.github/workflows/desktop-windows.yml`
- `.github/workflows/desktop-macos.yml`

Both platform workflows install Node, Rust, uv, package the backend runtime,
stage it for Tauri, build the desktop app, and validate that the bundled
Python can import `ldaca_wordflow` and `polars_text`. The release workflow
then uploads MSI and DMG assets to the GitHub release.
