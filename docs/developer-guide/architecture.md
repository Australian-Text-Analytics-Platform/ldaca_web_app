# Monorepo Architecture

Wordflow is a full-stack text-analysis application packaged as both a web app
and a desktop app. The repository is a monorepo with several independently
useful projects:

- `frontend/`: React 19 + Vite + TypeScript UI, plus the Tauri v2 desktop shell.
- `backend/`: FastAPI application published as `ldaca-wordflow`.
- `docworkspace/`: Python library for Polars LazyFrame node graphs.
- `polars-text/`: Rust/PyO3 Polars plugin package for text processing and
  serialized plan path rewriting.

## Runtime Shape

The frontend is the user-facing client. It talks to the backend over HTTP,
uses Server-Sent Events for task updates, and renders workspace lineage with
React Flow. The backend owns authentication, user folders, workspace loading,
node operations, analysis orchestration, and artifact storage.

The backend uses `docworkspace` as its in-memory workspace graph model.
Workspace nodes wrap Polars `LazyFrame` plans and are persisted as
`metadata.json` plus `.plbin` plan files. The backend uses `polars-text` for
tokenization helpers, token-frequency primitives, and portable workspace loads
that rewrite absolute scan paths inside `.plbin` plans.

The desktop app is not a separate frontend. Tauri hosts the same Vite-built UI,
ships a relocatable Python backend runtime, starts the backend on an available
localhost port, injects that URL into the webview, and shuts the backend down
with the native window.

## Data Flow

1. A user creates or opens a workspace from the frontend.
2. The backend's `WorkspaceManager` loads exactly one active in-memory
   `Workspace` per user while keeping many saved workspaces on disk.
3. File imports create root nodes backed by lazy Polars scans.
4. Node operations create or mutate workspace nodes and save the workspace.
5. Long-running analysis requests submit process-pool worker tasks.
6. Workers write large outputs to workspace artifacts or analysis caches.
7. The task manager emits task and workspace events over `/api/tasks/stream`.
8. The frontend updates Zustand and TanStack Query caches from those events.

## Package Boundaries

The root package is mostly orchestration. `package.json` forwards JS commands
to `frontend/`; root `pyproject.toml` is a uv workspace shim that resolves the
local backend package. The nested repositories are real project boundaries, so
their manifests and tests should be read before changing them.

Generated and runtime directories are deliberately outside the design surface:
`node_modules/`, `.git/`, `dist/`, `.wrangler/`, Tauri build outputs, virtual
environments, packaged backend runtimes, and vendored runtime copies should not
drive architecture decisions.
