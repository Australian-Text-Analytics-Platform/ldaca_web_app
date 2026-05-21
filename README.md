# LDaCA Wordflow Monorepo

This repository (previously `ldaca_web_app`) contains the LDaCA Wordflow web app and desktop app, plus the shared Python and Rust packages they depend on. The main product is a multi-platform text analytics application with a FastAPI backend, a React frontend, and a Tauri desktop shell.

## Repository Overview

- `frontend/`: React 19 + Vite frontend, shared UI, and Tauri desktop shell in `src-tauri/`
- `backend/`: FastAPI backend (PyPI: `ldaca-wordflow`, import: `ldaca_wordflow`) and workspace/task APIs
- `docworkspace/`: lazy workspace graph library built around `Workspace` and `Node`
- `polars-text/`: Rust/PyO3 Polars plugin package for concordance, quotation, tokenization, and related text analysis

## Architecture Summary

### Backend

The backend lives under `backend/src/ldaca_wordflow/` and is organized around:

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

Worker functions are registered in `backend/src/ldaca_wordflow/core/worker.py`.

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
- Node.js and pnpm
- Rust and Cargo when working on `polars-text` or Tauri packaging

### Install Dependencies

From the repo root:

```sh
uv sync
pnpm install
```

Do not set `PYTHONPATH` manually for normal development. `uv` handles editable installs and resolution.

## Common Commands

### Frontend

```sh
pnpm -C frontend dev
pnpm -C frontend build
pnpm -C frontend test -- --run
```

### Backend Commands

```sh
cd backend && uv run uvicorn ldaca_wordflow.main:app --reload --port 8001
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

Run checks from the affected package directory, not from the repo root, unless the command explicitly targets a package with `pnpm -C`.

For Python package changes, the expected verification is:

```sh
uvx ty check
uv run pytest
```

For typical frontend changes, use:

```sh
pnpm -C frontend build
pnpm -C frontend test -- --run
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
