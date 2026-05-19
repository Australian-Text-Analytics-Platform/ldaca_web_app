# AGENTS.md

Start here before exploring. This monorepo (renamed from `ldaca_web_app`; PyPI now `ldaca-wordflow`) contains the LDaCA Wordflow web app and desktop app: a React 19 + Vite + Tauri frontend in `frontend/`, a FastAPI backend in `backend/`, and supporting Python/Rust packages in `docworkspace/` and `polars-text/`. Treat package manifests, CI workflows, and build scripts as the source of truth when docs disagree.

## Repo Map

- `frontend/`: React 19, Vite 8, TypeScript, Vitest, ESLint, Tauri desktop shell in `src-tauri/`
- `backend/`: FastAPI backend (PyPI: `ldaca-wordflow`, import: `ldaca_wordflow`), uv-managed, Python `>=3.14`
- `docworkspace/`: Python package for lazy Polars workspace/node graphs
- `polars-text/`: Rust/PyO3 + Python package for text-analysis primitives
- Root `package.json`: pnpm workspace command wrapper for `frontend`
- Root `pyproject.toml`: uv workspace shim; do not rely on `PYTHONPATH=src`

## Environment And Order

Use this order for a fresh task:

1. Confirm prerequisites: Node/pnpm, `uv`, Python `3.14+`, and Rust/Cargo if touching `polars-text` or Tauri.
2. From repo root, run `uv sync`.
3. Install JS deps from the repo root with `pnpm install` if `node_modules/` is absent.
4. Run package-specific checks from the package directory, or use root wrapper scripts that call `pnpm -C frontend ...`.

Do not set `PYTHONPATH` manually for normal local development. uv handles resolution. The packaged desktop runtime sets `PYTHONPATH` internally; that is a packaging detail, not a dev setup pattern.

When debugging local Python packages that `pyproject.toml` normally resolves from PyPI, prefer editable local installs or uv path sources so changes in sibling packages are tested directly instead of against a released wheel.

## Validated Commands

These were validated in this workspace and are the fastest reliable entry points for agents:

- Bootstrap: `uv sync` from repo root, passes.
- Frontend run: existing dev server responds on `http://127.0.0.1:3000/` with Vite HTML.
- Frontend build: `pnpm -C frontend build`, passes.
- Frontend tests: `pnpm -C frontend test -- --run`, passes (`27` files, `70` tests).
- Backend run: existing backend responds on `http://127.0.0.1:8001/health`.
- Backend tests: `cd backend && uv run pytest -q`, passes (`269` tests).
- `docworkspace` tests: `cd docworkspace && uv run pytest -q`, passes.
- `polars-text` tests: `cd polars-text && uv run pytest -q`, passes.

## Practical Rules For Agents

- Trust this file first, then check the nearest manifest, CI workflow, or build script before doing broad repo exploration.
- Prefer `pnpm -C frontend ...` from repo root for frontend commands.
- Prefer `uv run ...` inside Python package directories.
- Whenever you modify a Python project in this repo, run `uvx ty check` and `uv run pytest` from each affected Python package directory and make sure both commands pass before considering the work complete.
- Do not run backend tests from repo root; run them from `backend/`.
- If you touch desktop packaging, inspect `scripts/package_backend_runtime.py` and `frontend/scripts/stage-backend-runtime.mjs` before changing anything.
- Expect backend data under `~/Documents/ldaca` unless `DATA_ROOT` overrides it.
- Some `polars-text` features download Hugging Face assets on first use; avoid treating that as an unexpected network regression.

## Codebase-Specific AI Rules

- Avoid eager `collect()` except at I/O boundaries, artifact writing, or final response serialization.
- Keep backend routers thin. Validate request shapes in the router, then delegate business logic to `core/` or analysis helpers.
- Use `Depends(get_current_user)` for backend route authentication; do not bypass it in new routes.
- For worker tasks, follow the existing worker pattern: call `configure_worker_environment()` first, import heavy dependencies inside the worker function, and write large outputs to artifacts.
- In frontend code, do not add `useMemo`, `useCallback`, or `React.memo` for routine optimization. The repo uses React Compiler.

## Cutting A Release

Five files carry an independently-stamped version and **must** agree before tagging — pip wheel metadata, npm package, Tauri bundler, Rust crate, and the workspace pyproject. Drift between them is what shipped the v0.4.3 "desktop says 0.4.2 / pip says 0.4.3" bug.

1. `pnpm bump-version <semver>` from repo root rewrites all five in one pass. Don't edit version strings by hand.
2. `pnpm check-versions` confirms they match; it's also wired as a pre-build gate in `.github/workflows/release.yml` so a tag push with drift never reaches the desktop builders.
3. `pnpm deploy_frontend_to_backend` after the bump — `VITE_APP_VERSION` is baked into the FE bundle at build time, so the bundle inside `backend/src/ldaca_wordflow/resources/frontend/build/` needs refreshing too.
4. Commit, tag `vX.Y.Z` on `v0.4`, push the tag → release.yml fires → desktop assets + PyPI publish.

## CI-Relevant Checks

For typical frontend changes, run:

- `pnpm -C frontend build`
- `pnpm -C frontend test -- --run`
- `pnpm -C frontend lint`

Frontend changes are not complete until both `pnpm -C frontend test -- --run` and `pnpm -C frontend lint` have been run after the edit.

For backend changes, run:

- `cd backend && uv run pytest -q`

For changes in any Python project, also run from the affected package directory:

- `uvx ty check`
- `uv run pytest`

For package-specific work, run only the impacted package tests instead of the full monorepo.
