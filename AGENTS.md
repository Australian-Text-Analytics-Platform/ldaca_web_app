# AGENTS.md

Start here before exploring. This monorepo contains the LDaCA web app and desktop app: a React 19 + Vite + Tauri frontend in `frontend/`, a FastAPI backend in `ldaca_web_app_backend/`, and supporting Python/Rust packages in `docworkspace/` and `polars-text/`. Treat package manifests, CI workflows, and build scripts as the source of truth when docs disagree.

## Repo Map

- `frontend/`: React 19, Vite 8, TypeScript, Vitest, ESLint, Tauri desktop shell in `src-tauri/`
- `ldaca_web_app_backend/`: FastAPI backend, uv-managed, Python `>=3.14`
- `docworkspace/`: Python package for lazy Polars workspace/node graphs
- `polars-text/`: Rust/PyO3 + Python package for text-analysis primitives
- Root `package.json`: npm workspace wrapper for `frontend`
- Root `pyproject.toml`: uv workspace shim; do not rely on `PYTHONPATH=src`

## Environment And Order

Use this order for a fresh task:

1. Confirm prerequisites: Node/npm, `uv`, Python `3.14+`, and Rust/Cargo if touching `polars-text` or Tauri.
2. From repo root, run `uv sync`.
3. Install JS deps at repo root with `npm install` if `node_modules/` is absent. In this workspace, dependency state was validated with `npm ls --depth=0` because `node_modules/` already existed.
4. Run package-specific checks from the package directory, not from repo root, unless the command explicitly uses `-w frontend`.

Do not set `PYTHONPATH` manually for normal local development. uv handles resolution. The packaged desktop runtime sets `PYTHONPATH` internally; that is a packaging detail, not a dev setup pattern.

## Validated Commands

These were validated in this workspace and are the fastest reliable entry points for agents:

- Bootstrap: `uv sync` from repo root, passes.
- Frontend run: existing dev server responds on `http://127.0.0.1:3000/` with Vite HTML.
- Frontend build: `npm run build -w frontend`, passes.
- Frontend tests: `npm run test -w frontend -- --run`, passes (`27` files, `70` tests).
- Backend run: existing backend responds on `http://127.0.0.1:8001/health`.
- Backend tests: `cd ldaca_web_app_backend && uv run pytest -q`, currently fails with `1` existing failing test.
- `docworkspace` tests: `cd docworkspace && uv run pytest -q`, passes.
- `polars-text` tests: `cd polars-text && uv run pytest -q`, passes.

## Current Known Failures

Do not assume the repo is green before your change:

- `npm run lint -w frontend` currently fails with `5` existing ESLint errors.
- `cd ldaca_web_app_backend && uv run pytest -q` currently fails at `tests/unit/test_package_backend_runtime.py::test_sync_runtime_environment_uses_frozen_non_editable_sync`.
- `npm run prepare:backend-runtime -w frontend` currently fails after rebuilding `ldaca_web_app_backend/dist-tauri/` with `ModuleNotFoundError: No module named 'ldaca_web_app_backend'` during the runtime smoke import.
- `cd polars-text && make test` is not reliable in this environment because it calls bare `pytest`; use `uv run pytest -q` instead.

Because `prepare:backend-runtime` uses `--clean`, it is side-effectful and rewrites `ldaca_web_app_backend/dist-tauri/`.

## Practical Rules For Agents

- Trust this file first, then check the nearest manifest, CI workflow, or build script before doing broad repo exploration.
- Prefer `npm run ... -w frontend` from repo root for frontend commands.
- Prefer `uv run ...` inside Python package directories.
- Whenever you modify a Python project in this repo, run `uvx ty check` and `uv run pytest` from each affected Python package directory and make sure both commands pass before considering the work complete.
- Do not run backend tests from repo root; run them from `ldaca_web_app_backend/`.
- If you touch desktop packaging, inspect `ldaca_web_app_backend/scripts/package_backend_runtime.py` and `frontend/scripts/stage-backend-runtime.mjs` before changing anything.
- Expect backend data under `~/Documents/ldaca` unless `DATA_ROOT` overrides it.
- Some `polars-text` features download Hugging Face assets on first use; avoid treating that as an unexpected network regression.

## CI-Relevant Checks

For typical frontend changes, run:

- `npm run build -w frontend`
- `npm run test -w frontend -- --run`
- `npm run lint -w frontend` only if your change could affect or fix the existing lint baseline

For backend changes, run:

- `cd ldaca_web_app_backend && uv run pytest -q`

For changes in any Python project, also run from the affected package directory:

- `uvx ty check`
- `uv run pytest`

For package-specific work, run only the impacted package tests instead of the full monorepo.
