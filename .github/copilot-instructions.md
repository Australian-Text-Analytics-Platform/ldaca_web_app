## LDaCA Monorepo AI Guide (Web App & Desktop)

> **Maintenance note:** Keep this document in sync with the codebase. When a refactor changes patterns described here, update this file in the same PR.

---

### 1. Repository Layout

```
/                           ← npm + uv workspace root
├── backend/                ← FastAPI backend (Python ≥ 3.14)
│   ├── src/ldaca_web_app_backend/
│   │   ├── api/            ← FastAPI routers (all routes under /api/*)
│   │   │   └── workspaces/
│   │   │       └── analyses/  ← one module per analysis type
│   │   ├── analysis/       ← in-memory task storage & request schemas
│   │   ├── core/           ← business logic, worker tasks, utilities
│   │   ├── settings.py     ← pydantic-settings (env vars, no hardcoded secrets)
│   │   ├── db.py           ← SQLAlchemy models (User, UserSession)
│   │   └── main.py         ← FastAPI app lifecycle (startup/shutdown)
│   └── tests/
├── docworkspace/           ← workspace graph library (Workspace, Node)
├── polars-text/            ← Rust/PyO3 text-analysis extensions for Polars
├── ldaca-tabulator/        ← RO-Crate import/export utilities
├── frontend/               ← React 19 + Vite + TanStack + Shadcn/Radix
│   ├── src/
│   │   ├── api/            ← HTTP client & service modules
│   │   ├── features/       ← feature modules (analysis tabs, preprocessing, etc.)
│   │   ├── components/     ← reusable UI (Shadcn/Radix + Tailwind)
│   │   ├── hooks/          ← custom React hooks (workspace, auth, etc.)
│   │   ├── stores/         ← Zustand global state
│   │   ├── providers/      ← React context (QueryProvider, WorkspaceProvider)
│   │   ├── lib/            ← utilities (queryKeys, cn(), caching)
│   │   └── types/          ← shared TypeScript types
│   └── src-tauri/          ← Tauri v2 desktop shell (Rust)
├── package.json            ← npm workspace root (delegates to frontend/)
└── pyproject.toml          ← uv workspace root (members: backend + local packages)
```

**Key libraries:**

| Layer | Package | Role |
|-------|---------|------|
| Backend | `docworkspace` | Lazy workspace graph — `Workspace` + `Node` containers for Polars `LazyFrame` data |
| Backend | `polars-text` | Rust-backed Polars plugin for concordance, token frequencies, etc. |
| Backend | `ldaca-loader` (ldaca-tabulator) | RO-Crate / CSV / Excel import/export |
| Frontend | `@tanstack/react-query` v5 | Server-state caching, polling, mutations |
| Frontend | `@tanstack/react-router` v1 | Client router (single-route SPA; navigation via Zustand `currentView`) |
| Frontend | `@tanstack/react-table` v8 | Data table rendering (sorting, pagination, column management) |
| Frontend | `zustand` v5 | Global UI + analysis task state |
| Frontend | `@xyflow/react` | Workspace graph visualization |
| Frontend | Shadcn/Radix + Tailwind v4 | Component library + styling |

---

### 2. Environment & Tooling

#### Python (uv workspace)

- **Minimum Python:** `>=3.14`.
- **Package manager:** [uv](https://docs.astral.sh/uv/). The Python package workspace is rooted at the repository `pyproject.toml` under `[tool.uv.workspace]`.
- **Install all Python deps:** `uv sync` from the repo root. This installs the backend plus `docworkspace`, `ldaca-tabulator`, and `polars-text` in editable mode — no need to set `PYTHONPATH`.
- **Run any script/command:** `uv run <command>`. Examples:
  ```sh
  # Start backend dev server
  cd backend && uv run uvicorn ldaca_web_app_backend.main:app --reload --port 8001

  # Run backend tests
  cd backend && uv run pytest

  # Run docworkspace tests
  cd docworkspace && uv run pytest
  ```
- **Add a dependency:** `uv add <package>` in the relevant workspace member directory under `backend/`.
- **Never** set `PYTHONPATH=src` — uv handles package resolution via editable installs.

#### Node.js (npm workspace)

- **`npm install`** at the repo root — `node_modules` lives only at the root.
- **Frontend dev server:** `npm run dev` (or `npm run dev -w frontend`).
- **Frontend build:** `npm run build -w frontend` (runs `tsc --noEmit` then `vite build`).
- **Frontend tests:** `npm run test -w frontend` (Vitest + jsdom).
- **Lint:** `npm run lint -w frontend` (ESLint, zero warnings policy).

#### Configuration

- Backend settings live in `backend/src/ldaca_web_app_backend/settings.py` — a `pydantic-settings` `BaseSettings` class that reads environment variables.
- Key env vars: `DATA_ROOT` (defaults to `~/Documents/ldaca`), `MULTI_USER` (bool), `GOOGLE_CLIENT_ID`, `BACKEND_PORT` (default 8001).
- **No hardcoded secrets.** API keys, OAuth secrets, etc. must come from environment variables.
- User data lives under `DATA_ROOT/users/` — never commit data file contents.

---

### 3. Backend Architecture

#### 3.1 Lazy-First Data Model

All node data **must** be a Polars `LazyFrame`. The `Node` constructor raises `TypeError` if given anything else:

```python
class Node:
    def __init__(self, data: pl.LazyFrame, ...):
        if not isinstance(data, pl.LazyFrame):
            raise TypeError(...)
```

- Avoid eager `.collect()` except at I/O boundaries (writing Parquet artifacts, serializing final API responses).
- Use pagination endpoints and preview APIs in routers — never collect an entire frame to send over the wire.

#### 3.2 Workspace & Node Graph

`docworkspace` provides the core data model:

- **`Workspace`** — container for a dictionary of `Node` objects keyed by UUID. One workspace per user is held in memory at a time.
- **`Node`** — wraps a `LazyFrame` with parent/child graph edges, an undo stack (max 50), and a document-column pointer.
- Auto-delegation: `node.filter(...)` delegates to the underlying `LazyFrame` and returns a new child `Node`.
- **`DocWorkspaceDataTypeUtils`** maps Polars dtypes → LDaCA dtype categories (`string`, `integer`, `annotation`, `list_string`, etc.) for frontend rendering. Preserve this mapping end-to-end.

#### 3.3 FastAPI Router Pattern

All routers live under `backend/src/ldaca_web_app_backend/api/` and are mounted with a `/api` prefix in `main.py`:

```python
app.include_router(workspaces_router, prefix="/api", tags=["workspace_management"])
```

The workspace router itself composes sub-routers:

```python
# api/workspaces/__init__.py
router = APIRouter()
router.include_router(lifecycle.router)       # POST/GET /workspaces/*
router.include_router(nodes.router)           # Node CRUD
router.include_router(token_frequencies.router)
router.include_router(concordance.router)
# ... etc.
```

**To add a new API endpoint:**

1. Create a module under `api/workspaces/analyses/` (e.g., `my_analysis.py`).
2. Define a `router = APIRouter(prefix="/workspaces")`.
3. Use `Depends(get_current_user)` for authentication.
4. Keep the router thin — validate request via Pydantic, delegate to `core/` for business logic, return JSON.
5. Register the router in `api/workspaces/__init__.py`.

**Typical analysis endpoint pattern:**

```python
@router.post("/{workspace_id}/my-analysis/submit")
async def submit_my_analysis(
    workspace_id: str,
    request: MyAnalysisRequest,           # Pydantic model
    current_user=Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace = workspace_manager.get_current_workspace(user_id)
    # 1. Extract node data
    # 2. Create task in TaskManager
    # 3. Submit to ProcessPoolExecutor via TASK_REGISTRY
    # 4. Return {"task_id": ..., "state": "pending"}
```

#### 3.4 Background Analysis Tasks (Worker Pattern)

CPU-heavy analyses (BERTopic, polars-text, etc.) run in a `ProcessPoolExecutor`:

```
API Router → TaskManager (in-memory tracking)
           → ProcessPoolExecutor (worker function from TASK_REGISTRY)
           → Worker writes Parquet artifacts to disk
           → API reads artifacts lazily on result retrieval
```

- **`core/worker.py`** — manages the process pool and `TASK_REGISTRY` (maps task type → worker function).
- **`core/worker_task_manager.py`** — `WorkerTaskManager` tracks futures, provides progress streaming, supports cancellation.
- **`analysis/manager.py`** — `TaskManager` stores per-user task metadata (`{task_id → AnalysisTask}`).

**To add a new worker task:**

1. Create `core/worker_tasks_myanalysis.py` with a `run_my_analysis_task(configure_worker_environment, ...) → dict` function.
2. The function must call `configure_worker_environment()` first, then import heavy deps inside the function body (imports stay in the worker process).
3. Write output to Parquet in `artifact_dir`, return a dict with `state`, `result`, and `message`.
4. Register in `TASK_REGISTRY` in `core/worker.py`.

#### 3.5 Authentication

- **Single-user mode** (default, `MULTI_USER=false`): `get_current_user` returns a hardcoded root user dict — no real auth.
- **Multi-user mode** (`MULTI_USER=true`): validates Bearer tokens against SQLite sessions; supports Google OAuth.
- Always use `Depends(get_current_user)` in routers — never bypass auth.

#### 3.6 API Response Models

Shared Pydantic models in `core/api_models.py`:

- `ColumnSchema` — `{name, dtype, js_type}` for serializing column metadata.
- `NodeSummary` — node info for API responses (id, name, shape, columns, schema, parent/child IDs).
- `PaginatedData` — `{data, pagination, columns, schema}` for paginated table responses.
- `OperationResult` — `{success, message, node_id?, data?, errors}`.

---

### 4. Frontend Architecture

#### 4.1 React Compiler — No Manual Memoization

The project uses **React Compiler** (`babel-plugin-react-compiler`) targeting React 19:

```ts
// vite.config.ts
const reactWithCompiler = react({
  babel: {
    plugins: [
      ['babel-plugin-react-compiler', { target: '19', runtimeModule: 'react-compiler-runtime' }],
    ],
  },
});
```

**Rules:**
- **Do NOT use** `useMemo`, `useCallback`, or `React.memo` for performance. The compiler handles memoization automatically.
- It is acceptable to use `useMemo` / `useCallback` only when semantics require identity stability at a system boundary (e.g., passing a callback to a non-React library that compares by reference). Add a comment explaining why.
- Do NOT add `useCallback` to event handlers, `useMemo` to derived values, or `React.memo` to components — the compiler does this better.

#### 4.2 State Management Stack

| Concern | Tool | Location |
|---------|------|----------|
| Server state (workspace data, task results) | TanStack Query v5 | `providers/QueryProvider.tsx`, hooks under `hooks/` |
| Global UI state (current view, modals, loading) | Zustand v5 (+ immer + devtools + persist) | `stores/uiStore.ts` |
| Analysis task tracking | Zustand | `stores/analysisStore.ts` |
| Workspace data + selection + actions | React Context (`WorkspaceProvider`) | `providers/WorkspaceProvider.tsx` |
| Per-feature local state | `useState` / `useRef` | Inside feature components |

**Query key factory** in `lib/queryKeys.ts`:

```ts
export const queryKeys = {
  workspaces: () => ['workspaces'],
  workspace: (id: string) => ['workspace', id],
  nodes: (workspaceId: string) => ['workspace', workspaceId, 'nodes'],
  nodeData: (nodeId: string) => ['node', nodeId, 'data'],
  taskResult: (taskId: string) => ['task', taskId, 'result'],
  taskStatus: (taskId: string) => ['task', taskId, 'status'],
};
```

#### 4.3 API Layer

All HTTP calls go through `api/http.ts` which provides `get`, `post`, `put`, `del` helpers wrapping `fetch` with:
- Automatic JSON serialization/parsing
- Timeout via `AbortController` (default 30s)
- `ApiError` class with status, code, and detail
- Query param building

Service modules (`api/text.ts`, `api/workspaces.ts`, `api/nodes.ts`, etc.) export domain-specific API objects:

```ts
export const textApi = {
  tokenFrequencies: (req, headers?) => post('/text/token-frequencies', req, headers),
  getTokenFrequenciesTaskResult: (taskId, headers?) => get(`/tasks/${taskId}/result`, headers),
  // ...
};
```

**Backend URL detection** (`api/env.ts`) handles multiple environments automatically:
1. Tauri desktop app (`window.__BACKEND_URL__`)
2. `VITE_BACKEND_API_BASE` env var
3. Jupyter/Binder proxy paths
4. Localhost with configurable port
5. Same-origin `/api` fallback

**Never hardcode `localhost` URLs** — use `getApiBase()` from `api/env.ts`.

#### 4.4 Feature Tab Pattern (Analysis Features)

Every analysis feature under `features/analysis/` follows a consistent structure:

```
features/analysis/<my-analysis>/
├── MyAnalysisFeature.tsx          ← main component
├── hooks/
│   ├── useMyAnalysisTaskFlow.ts   ← task submission & interaction logic
│   └── useMyAnalysisPreferences.ts ← feature-specific preferences
├── components/
│   ├── panels/
│   │   ├── MyAnalysisParameterPanel.tsx
│   │   └── MyAnalysisResultsPanel.tsx
│   └── results/
│       └── MyAnalysisResultSection.tsx
├── myAnalysisAdapters.ts          ← data transformation utilities
└── __tests__/
```

**The main feature component follows this lifecycle pattern:**

```tsx
const MyAnalysisFeature = () => {
  // 1. AUTH & WORKSPACE CONTEXT
  const { getAuthHeaders } = useAuth();
  const { currentWorkspaceId } = useWorkspaceData();

  // 2. ANALYSIS LOCK (persists params while task runs, restores on hydration)
  const { isLocked, panelSelectedNodes, lockWithSnapshots, unlockSelection, ... } =
    useAnalysisLock({
      analysisType: 'my_analysis',
      workspaceId: currentWorkspaceId,
      getAuthHeaders,
      allowedDataTypes: ['string'],
      maxNodes: 2,
    });

  // 3. LOCAL UI STATE
  const [results, resultRef, setResultSafely] = useSafeResult<MyAnalysisResponse>();

  // 4. ZUSTAND STORES (navigation, tasks)
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const setTasks = useAnalysisStore((s) => s.setTasks);

  // 5. COLOR MANAGEMENT (for multi-node visualizations)
  const { nodeColors, handleColorChange } = useNodeColorManagement({ ... });

  // 6. TASK LIFECYCLE (run, poll, fetch, clear — shared hook)
  const { resolveTaskId, isRunning, clearResults, ... } = useAnalysisFeature<MyAnalysisResponse>({
    analysisType: 'my_analysis',
    taskType: 'my_analysis',
    workspaceId: currentWorkspaceId,
    getAuthHeaders,
    isTabActive: /* ... */,
    resultRef,
    fetchResult: (taskId, headers) => textApi.getMyAnalysisResult(taskId, headers),
    onResultFetched: (result) => setResultSafely(result),
    onCleared: () => { setResultSafely(null); unlockSelection(); },
  });

  // 7. TASK FLOW HOOK (feature-specific run/interaction logic)
  const { handleAnalyze, ... } = useMyAnalysisTaskFlow({ state, actions, lock, navigation });

  // 8. RENDER — typically AnalysisCardLayout + parameter panel + results panel
  return (
    <div className="flex gap-4">
      <MyAnalysisParameterPanel ... />
      <MyAnalysisResultsPanel ... />
    </div>
  );
};
```

**Key shared hooks** in `features/analysis/common/`:
- `useAnalysisLock` — composes server lock query + local lock machine; persists parameters while a task is running so the user can't accidentally change them.
- `useAnalysisFeature` — manages the full task lifecycle: task ID resolution, polling, result fetching, hydration from server state, clearing.
- `useSafeResult` — ref-based result caching to avoid stale closures.
- `useNodeColorManagement` — assigns consistent colors to nodes across visualizations.

**Shared UI components** in `features/analysis/common/components/`:
- `AnalysisCardLayout` — Card wrapper with title, help icon, run/clear buttons, loading states.
- `AnalysisRunningStateCard` — display while a task is in progress.
- `NodeColumnSelector`, `NodeSelectionList`, `NodeColorPicker` — reusable selection widgets.
- `AnalysisPagination` (in `components/`) — shared pagination component across all analysis result views.

#### 4.5 UI Components (Shadcn + Tailwind)

- Components under `components/ui/` are Shadcn-generated (Radix primitives + CVA variants + Tailwind).
- Use `cn()` from `lib/utils.ts` to merge Tailwind class names.
- Icons from `lucide-react`.
- The path alias `@/` maps to `frontend/src/`.

#### 4.6 Sidebar Navigation

Navigation is **not URL-based** — the app is a single-route SPA. The sidebar drives navigation via Zustand:

```ts
const currentView = useUIStore((s) => s.currentView);  // e.g. 'token-frequency', 'concordance'
const setCurrentView = useUIStore((s) => s.setCurrentView);
```

`ViewType` includes: `data-loader`, `filter`, `token-frequency`, `concordance`, `topic-modeling`, `quotation`, `ai-annotator`, `export`, and more.

---

### 5. Tauri Desktop Shell

The Tauri v2 shell (`frontend/src-tauri/`) launches a bundled Python backend as a child process:

- **Runtime detection:** `main.rs` searches for the backend runtime in multiple candidate paths (bare, `_up_/`, `_up_/_up_/`, etc.) to handle macOS `.app` bundle layouts.
- **Backend URL injection:** The Rust side injects the backend URL into the webview via `window.__BACKEND_URL__`, which `api/env.ts` picks up.
- **Never** add platform-specific filesystem shortcuts — all data operations go through the backend over HTTP.
- **Build:** `npm run desktop:build:mac` (or `desktop:build:windows`) — requires running `scripts/package_backend_runtime.py` first to create the portable Python runtime.

---

### 6. Testing

#### Backend (pytest, async)

```sh
cd backend && uv run pytest                   # all backend tests
cd backend && uv run pytest tests/unit/       # unit tests only
cd backend && uv run pytest tests/integration/ # integration tests only
cd docworkspace && uv run pytest              # docworkspace tests
```

- `asyncio_mode = "auto"` — all async tests run automatically without `@pytest.mark.asyncio`.
- Test DB: in-memory SQLite via `conftest.py` session fixture.
- `authenticated_client` fixture: patches settings + injects mock user via `app.dependency_overrides`.
- `test_client` fixture: no auth (single-user mode).
- **Do NOT run `pytest` from the repo root** — run from the relevant workspace member.

#### Frontend (Vitest + jsdom)

```sh
cd frontend && npm test          # Vitest in watch mode
cd frontend && npx vitest run    # CI mode
```

- Setup file: `src/test/setup.ts`.
- Use `@testing-library/react` for component tests.

---

### 7. Quick Reference — Adding a New Analysis Feature

1. **Backend:**
   - Define a Pydantic request model in `analysis/implementations/`.
   - Create a worker function in `core/worker_tasks_<name>.py`.
   - Register in `TASK_REGISTRY` in `core/worker.py`.
   - Add a router module in `api/workspaces/analyses/<name>.py` with submit/result/clear endpoints.
   - Include the router in `api/workspaces/__init__.py`.
2. **Frontend:**
   - Create a feature directory under `features/analysis/<name>/`.
   - Implement the main feature component following the lifecycle pattern (§4.4).
   - Add a task flow hook (`useMyAnalysisTaskFlow`) for submission logic.
   - Add API functions to `api/text.ts`.
   - Register the view type in `stores/uiStore.ts` (`ViewType` union) and `Sidebar.tsx`.
3. **Do NOT** manually memoize — the React Compiler handles it.
4. **Do NOT** set `PYTHONPATH` — `uv sync` handles it.

---

### 8. Detailed Instructions

- `.github/instructions/python.instructions.md`
- `.github/instructions/playwright-python.instructions.md`
- `.github/instructions/security-and-owasp.instructions.md`
- `.github/instructions/performance-optimization.instructions.md`
- `.github/instructions/ai-prompt-engineering-safety-best-practices.instructions.md`
- `.github/instructions/rust-python.instructions.md`
- `.github/instructions/rust.instructions.md`
- `.github/instructions/react-tanstack-shadcn-tailwind.instructions.md`
- `.github/instructions/nodejs-javascript-vitest.instructions.md`