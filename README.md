# LDaCA Web App Monorepo

This repository contains the LDaCA web app and desktop app, plus the shared Python and Rust packages they depend on. The main product is a multi-platform text analytics application with a FastAPI backend, a React frontend, and a Tauri desktop shell.

## Repository Overview

- `frontend/`: React 19 + Vite frontend, shared UI, and Tauri desktop shell in `src-tauri/`
- `backend/`: FastAPI backend (PyPI: `ldaca-web-app`, import: `ldaca_web_app`) and workspace/task APIs
- `docworkspace/`: lazy workspace graph library built around `Workspace` and `Node`
- `polars-text/`: Rust/PyO3 Polars plugin package for concordance, quotation, tokenization, and related text analysis
- `ldaca-tabulator/`: RO-Crate and tabular import/export utilities

## Architecture Summary

### Backend

The backend lives under `backend/src/ldaca_web_app/` and is organized around:

- `api/`: FastAPI routers, mounted under `/api`
- `analysis/`: in-memory task storage and request schemas
- `core/`: worker tasks, business logic, and utilities
- `settings.py`: `pydantic-settings` configuration
- `db.py`: SQLAlchemy user and session models
- `main.py`: app lifecycle and router composition

Workspace-related APIs are composed under `api/workspaces/`, with one module per analysis type under `api/workspaces/analyses/`.

### Data Model

`docworkspace` is the core data model used by the backend.

- `Workspace` stores a graph of `Node` objects keyed by UUID.
- `Node.data` must always be a Polars `LazyFrame`.
- Node operations such as filtering or selection produce child nodes and preserve lineage.

This repository is lazy-first. Avoid eager `collect()` calls except at I/O boundaries such as artifact writing or final API serialization.

### Background Processing

Heavy analyses such as topic modeling and `polars-text`-backed tasks run out of process:

`API Router -> Task Manager -> ProcessPoolExecutor -> worker task -> Parquet artifacts -> API result retrieval`

Worker functions are registered in `backend/src/ldaca_web_app/core/worker.py`.

### Frontend Commands

The frontend uses:

- React 19
- Vite
- TanStack Query
- TanStack Router
- TanStack Table
- Zustand
- Shadcn/Radix with Tailwind CSS v4

Feature code is organized under `frontend/src/features/`, with analysis tabs following a shared feature pattern built around task lifecycle hooks and result panels.

### Desktop Shell

The desktop app uses Tauri v2. The Rust shell launches the packaged backend as a child process and injects the backend URL into the webview.

## Development Setup

### Prerequisites

- Python `>=3.14`
- `uv`
- Node.js and npm
- Rust and Cargo when working on `polars-text` or Tauri packaging

### Install Dependencies

From the repo root:

```sh
uv sync
npm install
```

Do not set `PYTHONPATH` manually for normal development. `uv` handles editable installs and resolution.

## Common Commands

### Frontend

```sh
npm run dev -w frontend
npm run build -w frontend
npm run test -w frontend -- --run
```

### Backend Commands

```sh
cd backend && uv run uvicorn ldaca_web_app.main:app --reload --port 8001
cd backend && uv run pytest -q
cd backend && uvx ty check
```

### Shared Python Packages

```sh
cd docworkspace && uv run pytest -q
cd docworkspace && uvx ty check

cd polars-text && uv run pytest -q
cd polars-text && uvx ty check
```

## Testing And Verification

Run checks from the affected package directory, not from the repo root, unless the command explicitly targets a workspace member.

For Python package changes, the expected verification is:

```sh
uvx ty check
uv run pytest
```

For typical frontend changes, use:

```sh
npm run build -w frontend
npm run test -w frontend -- --run
```

## Key Conventions

- All backend routes are mounted under `/api`.
- Use `Depends(get_current_user)` in backend routers; do not bypass auth checks.
- Keep FastAPI routers thin and move business logic into `core/`.
- For new worker tasks, call `configure_worker_environment()` first and import heavy dependencies inside the worker function.
- Do not hardcode `localhost` in frontend API code; use the backend URL detection utilities in `frontend/src/api/env.ts`.
- Do not add manual React memoization by default. This repo uses React Compiler.

## Documentation

- Backend docs: `backend/docs/index.md`
- Frontend docs: `frontend/docs/index.md`
- Agent workflow and repo-specific coding guidance: `AGENTS.md`

## License

LDaCA Web App is licensed under the [Apache License, Version 2.0](./LICENSE). See [NOTICE](./NOTICE) for required attribution.

This branch (`v0.3`) is parked as the back-port line for the pre-rename `ldaca-web-app` release series. The project was renamed to "LDaCA Wordflow" at v0.4.2; active development continues on the `v0.5` branch. The relicense from MIT to Apache 2.0 was first applied on `v0.5` and back-ported here for consistency.
