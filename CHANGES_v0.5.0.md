# Changes: 518efd9 → 791d7a2 (v0.2.x-line → v0.5.0)

**691 files changed: 346 added, 133 deleted, 131 modified, 81 renamed. +110,191 / −41,751 lines.**

---

## 0. Submodule Commits

| Submodule | From | To | Δ |
|-----------|------|----|---|
| `backend` | `9ac4558` | `0535f62` | 207 commits |
| `docworkspace` | `ee95697` | `e82b22c` | 21 commits |
| `polars-text` | `7c8b9b9` | `943543f` | 34 commits |
| `polars-source-utils` | — | `c989c52` | **new** |
| `ldaca-tabulator` | `b1efdff` | — | **removed** |

---

## 1. Repo Rename & Rebranding

The entire project was renamed from "LDaCA Web App" / `ldaca_web_app` to "LDaCA Wordflow" / `ldaca_wordflow`:

- **Backend module:** `src/ldaca_web_app/` (deleted, 64 files) → `src/ldaca_wordflow/` (new, 88 `.py` files). PyPI package: `ldaca-web-app` → `ldaca-wordflow`.
- **Frontend:** npm package `ldaca_web_app_frontend` → `ldaca_wordflow_frontend`.
- **Tauri:** Cargo package `ldaca-web-app` → `ldaca-wordflow`. Product name `LDaCA Text Analytics` → `LDaCA Wordflow`. Window title likewise.
- **HTML:** `<title>` changed from `LDaCA Text Analytics` to `LDaCA Wordflow`.
- **Submodules:** Backend `.gitmodules` entry renamed from `ldaca_web_app_backend` to `ldaca_wordflow_backend`, URL updated to `ldaca-wordflow-backend.git`.
- **README, AGENTS.md, .vscode/tasks.json** updated.
- **Version chain:** `0.2.9` → `0.3.x` → `0.4.0` (rename) → `0.4.x` → `0.5.0`.

---

## 2. Submodule Changes

### 2.1 Removed: `ldaca-tabulator`

The `ldaca-tabulator` submodule (at `b1efdff`) was removed from `.gitmodules`. It was the LDaCA tabular metadata reader, no longer needed.

### 2.2 New: `polars-source-utils`

Extracted from `polars-text`, provides `list_source_paths()` and `replace_source_paths()` for inspecting and rewriting source paths inside binary Polars LazyFrame plans. Used by `docworkspace` for workspace persistence (rebasing absolute paths after folder moves). Rust/PyO3 crate + Python package at `c989c52`.

### 2.3 docworkspace (`ee95697` → `e82b22c`, 21 commits)

- **`Node.derived` dict (Phase 2.4 v2):** Replaced flat `language`/`tokenizer_model` fields with a per-column `DerivedColumnMeta` registry (`source_column`, `form`, `model`, `language`, `generated_at`). Round-tripped through `to_dict`/`from_dict`. Cascade rules for `drop`, `rename`, `select`, `join`. Added `tokenizer_models` list to node metadata.
- **Source-path rewiring:** All `polars_text.{list,replace}_source_paths` imports moved to `polars-source-utils`.
- **Graph fallback:** `graph_json()` wraps per-node `info()` calls in try/except. Broken nodes return `{id, name, operation, child_ids, error}` instead of crashing the whole graph endpoint.
- **GC fix:** Workspace's existing garbage collector (which runs on every `write_workspace()` to remove unreferenced `.plbin`/`.parquet` files) now skips dotfile-prefixed files (`.materialized_*.parquet`) so that analysis side-effect caches survive workspace saves.
- **Developer guide:** 4 new pages (architecture, node/workspace, persistence, testing).
- **Version bumps:** v0.2.5 → v0.2.8.

### 2.4 polars-text (`7c8b9b9` → `943543f`, 34 commits)

- **Pluggable tokenizer registry:** `model_id → Arc<Tokenizer>` with backends: English (HuggingFace `bert-base-uncased`), Chinese (Jieba), Japanese/Korean (Lindera: ja-ipadic, ja-unidic, ko-dic). Predefined model labels for API clients via `models.py`.
- **`tokenize_with_offsets()`:** New function emitting `{token, start, end}` structs.
- **Token cache:** DuckDB-backed (`token_cache.py`, 278 lines). SHA-256 content-addressed, keyed by `(model, params_hash, content_hash)`.
- **Performance:** Single-sweep byte→char conversion (O(N²)→O(C+N)), skip `to_lowercase()` for CJK backends, flat inner struct + zero-copy slice.
- **Plan-path extraction:** `plan_paths.rs` + `plan_paths.py` removed (extracted to `polars-source-utils`).
- **Developer guide:** 5 new pages.
- **Version:** v0.1.4 → v0.2.1.

---

## 3. Backend Changes

### 3.1 Module Rename

All Python source moved from `src/ldaca_web_app/` to `src/ldaca_wordflow/`. Internal imports updated. `<vendor>/GenderGapTracker` retained, new `_vendor/rocrate-tabular` added.

### 3.2 Model File Split

The old monolithic `models/__init__.py` was split into 14 domain files: `ai_annotation.py`, `analysis_common.py`, `auth.py`, `concordance.py`, `db.py`, `files.py`, `nodes.py`, `polars_expression.py`, `preferences.py`, `quotation.py`, `sequential_analysis.py`, `token_frequencies.py`, `topic_modeling.py`, `workspace.py`.

### 3.3 API Route Split

Node routes split from one file into 8: `nodes.py` (router), `nodes_crud.py`, `nodes_concat.py`, `nodes_expression.py`, `nodes_filter.py`, `nodes_join.py`, `nodes_replace.py`, `nodes_slice.py`. Workspace routes split into `base.py`, `lifecycle.py`, `utils.py`. New `api/files/` directory split from `api/files.py`.

### 3.4 New Core Modules

| Module | Purpose |
|--------|---------|
| `analysis_cache.py` | Lifecycle management for analysis side-effect caches (`materialized_*.parquet`) |
| `analysis_helpers.py` | Shared analysis utilities |
| `analysis/persistence.py` | Save/load analysis task records to disk per workspace |
| `auth_service.py` (258 lines) | Authentication service |
| `data_loading.py` | Dtype normalization on data load via canonical profile |
| `embedding_cache.py` (283 lines) | DuckDB embedding cache, SHA-256 content-addressed, float16 storage |
| `exceptions.py` | Centralized exception hierarchy |
| `ldaca_tabular_config.py` | LDaCA tabular configuration parsing |
| `oni_client.py` (578 lines) | Oni API client for LDaCA Data Portal integration |
| `parent_watchdog.py` | Backend self-destructs when Tauri parent process dies |
| `polars_expr_validator.py` (243 lines) | Polars expression validation with assignment support |
| `polars_operations.py` | Polars operations registry |
| `sample_data.py` | Sample data management |
| `serialization.py` | Centralized serialization helpers |
| `server_launcher.py` (143 lines) | Unified server entrypoint for desktop + dev |
| `spa.py` (141 lines) | Single Page Application serving |
| `task_artifacts.py` (270 lines) | Task artifact management with enhanced cleanup |
| `tokenization.py` | Tokenization metadata registration on nodes |
| `tokens_cache.py` (99 lines) | Per-user DuckDB token cache path resolution + hydration |
| `user_folders.py` (201 lines) | Per-user folder path resolution |
| `worker_tasks_download.py` | Download worker |
| `worker_tasks_quotation.py` | Quotation analysis worker |
| `worker_tasks_token.py` | Token frequency worker |
| `worker_utils.py` | Shared worker utilities |

### 3.5 New API Routes

- `api/admin.py` — admin cleanup, user listing
- `api/config.py` — runtime configuration endpoint
- `api/workspaces/tabs.py` — workspace tab persistence (`tabs.json` sidecar)
- `api/workspaces/ui_state.py` — node colour persistence (`ui_state.json` sidecar)
- `api/workspaces/schema_filter.py` — schema-aware filtering
- `api/workspaces/analyses/cleanup.py` — analysis cleanup
- `api/workspaces/analyses/current_tasks.py` — per-analysis-type current task queries
- `api/workspaces/analyses/ai_annotation.py` + `ai_annotation_core.py` — AI annotation routes

### 3.6 Tokenization & Tokens Cache

**Current implementation:** The token cache is DuckDB-based:
- `tokens_cache.py`: `TOKENS_CACHE_FILENAME = "tokens.duckdb"`, per-user path via `get_user_cache_folder(user_id)`.
- `hydrate_tokenization_lazyframe()` attaches a cache-backed Polars expression via `pl.col(...).text.tokenize(..., cache=path)`.
- The actual cache engine lives in **polars-text** (`token_cache.py`): DuckDB schema with PK `(model, params_hash, content_hash)`, SHA-256 content-addressing, thread-safe via `threading.Lock`.
- 8 predefined tokenizer models: `native:plain_words_en`, `huggingface:bert-base-uncased`, `lindera:cc-cedict`, `lindera:jieba`, `lindera:ja-ipadic`, `lindera:ja-unidic`, `lindera:ko-dic`, `lindera:ja-ipadic-neologd`.
- `tokenization.py`: `tokenise_column()` registers metadata on `Node.tokenization` dict. CJK models default to `lowercase=False`.
- `concordance_tokens_mode.py`: Tokens-mode concordance — exact-token matching with multi-keyword alternation, byte-offset-based KWIC window slicing.
- `generated_columns.py`: Canonical column naming (`tokenization.<source>.<model>`) with parse/inverse helpers.

### 3.7 Topic Modeling

**Current implementation:** Pure BERTopic pipeline, single embedding model.

- **Embedding:** `sentence-transformers/all-MiniLM-L6-v2` at pinned revision `c9745ed1d9f207416be6d2e6f8de32d1f16199bf`. Uses native `SentenceTransformer` (PyTorch), per-process cached. No ONNX, no MPS device selection, no language-routed model selection.
- **Clustering:** Standard BERTopic with `UMAP(n_neighbors=15, n_components=5, min_dist=0.0, metric="cosine")` + default HDBSCAN. No IncrementalPCA, no MiniBatchKMeans.
- **Label vectorizer:** `sklearn CountVectorizer(stop_words="english")`.
- **Cache:** DuckDB `EmbeddingCache` — `embeddings.duckdb`, keyed by `(model_id, provider_id, SHA-256(content))`. float16 storage, float32 on read.
- **Features:**
  - Corpus sampling with reproducible Polars-based random sampling per node
  - Three topic size modes: `target` (heuristic), `min` (literal), `exact` (post-fit `reduce_topics()` with pickle checkpoint for re-aggregation)
  - Per-chunk embedding progress reporting (every 10 chunks)
  - Post-fit stopword filtering and scalable `top_n_words` buffer (`max(50, requested*2)`)
  - Topic coordinate projection: UMAP (cosine/Hellinger) for >15 topics, PCA for ≤15
  - Artifacts: per-node `topic_assignments_{id}.parquet` + `topic_meanings.parquet`
  - Worker split into 4 dedicated files: `topic.py`, `topic_embedding.py`, `topic_pipeline.py`, `topic_result.py`, `topic_types.py`

### 3.8 Auth & CILogon

- CILogon OIDC authentication support in `auth_service.py` (258 lines).
- Google OAuth retained.
- Multi-user mode via `MULTI_USER` env var (was `--multi-user` CLI flag).
- `api/auth.py` expanded from 291 to 554 lines.
- Middleware layer (`_middleware.py`) for auth enforcement.

### 3.9 Oni API Client

New `core/oni_client.py` (578 lines) for the LDaCA Data Portal Oni API: search records/documents/files, retrieve RO-Crate metadata, download corpus objects, list featured collections.

### 3.10 Test Changes

27 new test files added, 6 removed:
- New: `test_analysis_cache.py`, `test_analysis_task_persistence.py`, `test_concordance_dispersion_detach_worker.py`, `test_concordance_materialize_tokens_mode.py`, `test_concordance_page_size_all.py`, `test_concordance_tokens_mode.py`, `test_embedding_cache.py`, `test_filter_datetime_dtype.py`, `test_ldaca_tabular_config.py`, `test_node_tokenizer_preferences_endpoints.py`, `test_oni_client.py`, `test_openapi_operation_ids.py`, `test_polars_expr_validator.py`, `test_schema_filter.py`, `test_set_current_task_eviction.py`, `test_settings_ldaca.py`, `test_tabs_endpoint.py`, `test_token_frequency_artifact_rebuild.py`, `test_token_frequency_derived_path.py`, `test_tokenization_propagation_endpoints.py`, `test_tokenization_tokenise.py`, `test_tokens_cache.py`, `test_tokens_schema_constants.py`, `test_topic_modeling_stopwords.py`, `test_ui_state_endpoint.py`
- Removed: `test_compute_column_expression.py`, `test_lazy_flow.py`, `test_text_default_stop_words.py`, `test_token_frequency_defaults.py`, `test_topic_modeling_clear_endpoint.py`, `test_data_casting.py`, `test_join_behavior.py`

---

## 4. Frontend Changes

### 4.1 API Layer: Hand-Written → OpenAPI Generated

**Deleted (9 files):** `api/auth.ts`, `api/config.ts`, `api/env.ts`, `api/files.ts`, `api/http.ts`, `api/nodes.ts`, `api/preferences.ts`, `api/text.ts`, `api/workspaces.ts`.

**Added:** OpenAPI 3.1 spec (`frontend/openapi/ldaca-wordflow.openapi.json`, 16,866 lines) → `@hey-api/openapi-ts` generates 18 files (19,317 total lines) in `api/generated/`:
- `types.gen.ts` (10,643 lines): All TypeScript request/response types
- `sdk.gen.ts` (2,576 lines): Typed fetch functions for ~150 endpoints
- `@tanstack/react-query.gen.ts` (4,174 lines): Query key factories, query options, and mutation hooks (154 mutations, ~100+ queries)
- `client/` + `core/`: HTTP client factory, auth injection, body/query/path serializers, SSE streaming support

**Custom runtime config:** `lib/backend/generatedClientConfig.ts` provides URL resolution (6 priority levels), lazy auth header injection from Zustand store, 30-second timeouts, structured `ApiError` class.

**Environmental detection** moved from old `api/env.ts` to `lib/backend/env.ts`.

### 4.2 Feature Architecture Reorganization

The old flat `features/analysis/` directory was restructured into two top-level namespaces:

**`features/views/`** — All analysis views:
- `common/` — Shared infrastructure: `useAnalysisFeature`, `useAnalysisLockMachine`, `useAnalysisTaskStatus`, `useNodeColorManagement`, `AnalysisTabsHost` + tab system, pagination, charts, node/column selectors, tokenizer model selector, detach dialogs
- `ai-annotator/` — AI annotation (1,934 lines)
- `concordance/` — KWIC concordance + dispersion tables and charts
- `data-loader/` — File browser, upload, workspace manager, sample data import
- `export/` — Multi-format data download
- `preprocessing/` — 7 subtools: Filter, Slice, Join, Concat, Replace, Aggregate, Polars Expression
- `quotation/` — Full-text quotation extraction
- `sequential-analysis/` — Time-series trends analysis
- `token-frequency/` — Word frequency tables, word clouds, stopwords
- `topic-modeling/` — BERTopic bubble chart, topic selection

**`features/workspace/`** — Workspace state management:
- `common/` — `WorkspaceProvider` (4-slice context: Data, Selection, Status, Actions), `useWorkspaceInternal`, `useWorkspaceNodeMutations`, `useSchemaManagement`
- `data-view/` — TanStack React Table with server-side pagination/sort/filter
- `graph-view/` — React Flow DAG visualization with dagre layout
- `task-stream/` — SSE EventSource client with task inbox merging into analysis store

Key components relocated:
- `CustomNode.tsx` → `features/workspace/graph-view/components/`
- `TutorialView.tsx` → replaced by `components/DocumentView.tsx` (generic Markdown viewer)
- `GoogleLogin.tsx` → `features/auth/components/`
- `AnalysisPagination.tsx` → `features/views/common/components/`
- `WorkspaceDataView.tsx` / `WorkspaceGraphView.tsx` → `features/workspace/`

### 4.3 Routing: TanStack Router (Single Route) + Zustand View Switching

- **`router.tsx`:** Single TanStack Router with one root route and one index route at `/`. Accepts `?view=` search param with 9 `ViewType` values: `data-loader`, `filter`, `token-frequency`, `concordance`, `analysis`, `topic-modeling`, `quotation`, `ai-annotator`, `export`.
- **`ViewRouteSync.tsx`:** Bidirectional bridge — URL `?view=` ↔ `useUIStore.currentView`. Prevents race conditions with `useRef` tracking.
- **`ViewRouter.tsx`:** Reads `currentView` from Zustand `uiStore`, lazily loads the matching feature component from a `VIEW_COMPONENTS` map. Switching views unmounts the previous component (hooks reset). Each feature wrapped in `<Suspense>` + `<ErrorBoundary>`.

### 4.4 Auth Architecture

Custom auth state machine in `features/auth/hooks/useAuth.ts` + `stores/authStore.ts` (Zustand):
- 5-phase lifecycle: `bootstrapping` → `ready` / `refreshing` → `degraded` → `fatal`
- Google OAuth in multi-user mode (token exchange via `/google-auth`)
- CILogon OIDC support added
- Bearer token in `localStorage` (key `auth_token`)
- 5-minute periodic refresh interval
- `App.tsx`: Backend health gate → `AuthGate` (blocking screen / login / workspace shell)

### 4.5 State Management

8 Zustand stores (all with `immer` middleware):
- `authStore.ts` — Auth lifecycle, bearer token management
- `uiStore.ts` — `currentView`, `visibleViews`, modals (6 kinds), hints, loading operations
- `preferencesStore.ts` — Dual persistence (localStorage + debounced backend sync)
- `analysisStore.ts` — Task array (lifecycle states), materialized events
- `selectionStore.ts` — `currentWorkspaceId`, `selectedNodeId`, `selectedNodeIds`
- `nodeColorsStore.ts` — Two-tier color system: assigned (persisted) + per-tab temp layer
- `freshNodesStore.ts` — Session-only "newly created" node highlighting
- `hintsStore.ts` — Dismissed hints + master toggle

Workspace uses a 4-context pattern (`WorkspaceProvider`) to minimize re-renders.

### 4.6 Tabbed Analysis Shell

All 5 analysis views share `AnalysisTabsHost`:
- Per-workspace tab groups persisted in `tabs.json` via `useWorkspaceTabs` (React Query)
- `AnalysisTabbedPanel` renders folder-style protruding tabs with rename/close/add
- Each tab remounts the feature component keyed by `tabId`
- `tabTaskId` linking remembers which task each tab ran
- For tabbed views, the `InsetCard` frame is transparent to avoid double-card nesting

### 4.7 New Components

| Component | Purpose |
|-----------|---------|
| `DocumentView.tsx` | Generic, zoomable, lazy-loaded Markdown viewer with placeholder substitution, internal link nav, anchor scrolling |
| `DocumentModalHost.tsx` | Hosts 4 `<Dialog>` slots (tutorial, warning, info, reference) |
| `DocLinkIcon.tsx` / `HelpIcon.tsx` / `InfoIcon.tsx` / `ReferenceIcon.tsx` | Unified documentation link icons resolving registry keys |
| `WorkspaceShell.tsx` | Root layout: providers, modals, hints, 3-column layout (sidebar + content + right panel) |
| `ChartImageDownloadDialog.tsx` | Shared AlertDialog for chart PNG/SVG/JPEG export |
| `popover.tsx` | Radix-based popover primitives |
| `disabled-reason-tooltip.tsx` | Wraps disabled controls with explanatory tooltip |
| `paginationRange.ts` | Extracted pagination range builder utility |

### 4.8 Hints / Coach-Marks System

New `features/hints/` with 6 contextual onboarding hints: no active workspace, workspace has no nodes, file uploaded not added, filter needs node selection, filter needs column selection. Uses `HintsController` (polls every 400ms), `HighlightRing` (blue ring + dim overlay), `HintBubble` (coach-mark with dismiss/Learn-more/CTA).

### 4.9 Documentation System

- Bundled docs in `public/tutorials/`, `public/information/`, `public/references/`, `public/warnings/`
- Registry system at `src/tutorials/`: bundled fallback → localStorage cache → remote fetch from `VITE_DOCS_BASE_URL`, stale-while-revalidate
- Compile-time string-literal union keys (`TutorialTargetKey`, `InfoTargetKey`, `ReferenceTargetKey`)
- EOL banner (`DocsEolBanner.tsx`) for docs version lifecycle

### 4.10 Analysis Lock Snapshots

All 5 analysis tools share `useAnalysisLockMachine` + `useAnalysisLock`: freezes selected workspace nodes when an analysis runs, captures metadata via TanStack Query, detects parameter drift via `hasLockedParameterDiff`/`hasNodeIdDiff`/`hasNodeColumnDiff`, restores selections on unlock.

---

## 5. Tauri Desktop Changes

### 5.1 Process Lifecycle Rewrite (`main.rs`, +350 lines)

- **Pidfile management:** Records backend PID to `backend.pid`. On startup, `reap_stale_backend()` force-terminates orphans from crashed sessions.
- **Windows shutdown:** `taskkill /F /T /PID` to kill entire process tree (was `child.kill()` which leaked orphans).
- **Unix shutdown:** `SIGTERM` to process group, escalates to `SIGKILL` group after 7 seconds.
- **`CREATE_NEW_PROCESS_GROUP`** (Windows), `process_group(0)` (Unix).
- **`LDACA_PARENT_PID`** env var passed to backend for parent_watchdog self-destruct.

### 5.2 Download Streaming (New)

`download_to_downloads` Tauri command streams URL responses directly to Downloads folder via Rust `reqwest`, bypassing WebView2/IPC boundary. Fixes >10MB Windows download failures.

### 5.3 New Tauri Plugins

`tauri-plugin-fs` (filesystem), `tauri-plugin-http` (IPC HTTP, enables `ipc:` in CSP), `tauri-plugin-opener` (reveal in file manager).

### 5.4 CSP Updates

`connect-src` includes `ipc:` and `http://ipc.localhost`. `frame-src` allows Qualtrics survey frames.

### 5.5 New Capability Permissions

`opener:allow-reveal-item-in-dir`, `fs:allow-download-*`, `http:default` (allows `127.0.0.1:*` and `localhost:*`).

---

## 6. CI/CD Changes

### 6.1 New Workflows

- **`release.yml`** (113 lines): Desktop release pipeline on `v*` tags or manual trigger. Jobs: `verify-versions` (runs `check-versions.mjs` — all 5 version sources must agree), `build-windows`, `build-macos`, `publish-release` (creates GitHub Release + uploads DMG/MSI).
- **`check-docs-drift.yml`** (23 lines): Runs on PRs touching `.ts`/`.tsx` files. Validates all `<Icon targetKey="…">` literals resolve to valid doc registry entries.

### 6.2 Desktop Workflow Updates

- Both `desktop-macos.yml` and `desktop-windows.yml` now support `workflow_call` (reusable by `release.yml`).
- Added `ref` input for manual branch/tag/SHA builds.
- Added `debug` input on Windows (TAURI_PROFILE=debug, console + DevTools).
- Rust nightly toolchain step added for PyO3 extension builds.
- Cache keys now include `polars-source-utils` files.
- All `npm` → `pnpm` commands.
- Validation checks updated for `ldaca_wordflow` + `polars_source_utils` imports.
- macOS app path: `LDaCA Text Analytics.app` → `LDaCA Wordflow.app`.

---

## 7. Version Infrastructure

### 7.1 5-Source Version Consistency

Version strings live in 5 files that must agree:
1. Root `pyproject.toml`
2. `backend/pyproject.toml`
3. `frontend/package.json`
4. `frontend/src-tauri/Cargo.toml`
5. `frontend/src-tauri/tauri.conf.json`

### 7.2 New Scripts

- **`scripts/bump-version.mjs`** (94 lines): Reads and rewrites all 5 version sources to target semver in one pass. Regex-based on the single version line in each file.
- **`scripts/check-versions.mjs`** (73 lines): Validates all 5 versions match. Exit 0 = consistent, 1 = drift, 2 = unrecognized version field. Wired as pre-build gate in `release.yml`.

---

## 8. Tooling Changes

### 8.1 npm → pnpm

- Root `pnpm-workspace.yaml` (6 lines): `packages: [frontend]`, `allowBuilds: { esbuild: true, msw: false }`.
- All scripts, CI steps, `.vscode/tasks.json` use pnpm.
- `npm ci` → `pnpm install --frozen-lockfile` in CI.

### 8.2 Prettier → Biome

- New `frontend/biome.jsonc` (21 lines): 2-space indent, LF, 100-char width, single quotes, trailing commas, semicolons, arrow parens.
- Removed `.prettierrc.json`, `.prettierignore`, `prettier` and `prettier-plugin-tailwindcss` dependencies.
- Linter disabled (ESLint still used).

### 8.3 TypeScript 5.9 → 6.0

### 8.4 ESLint

- Type-aware linting (`projectService: true`).
- New async-safety rules (all `error`): `no-floating-promises`, `no-misused-promises`, `await-thenable`, `require-await`.
- Generated API code (`api/generated/`) excluded.

### 8.5 Dependencies

**Frontend new production deps:** `@codemirror/lang-python`, `@uiw/react-codemirror` (in-app expression editing), `@dagrejs/dagre` (graph layout), `@sentry/react` (error monitoring), `@tauri-apps/plugin-fs|http|opener`, `hyparquet`, `jszip`, `iso-639-3`, `stopword`, `@mediapipe/tasks-text`, `@radix-ui/react-popover`, `@tanstack/react-form`.
**Frontend new dev deps:** `@hey-api/openapi-ts` 0.97 (API generation), `@biomejs/biome` 2.4 (formatter), `msw` 2.14 (mock service worker).
**Removed:** `dagre`, `@types/dagre`, `prettier`, `prettier-plugin-tailwindcss`.

**Backend:** `polars-text` 0.1.6 → 0.2.1. `docworkspace` → uv path source to sibling submodule. New: `polars-source-utils` as uv path source.

**Tauri:** New: `reqwest` 0.12 (with `rustls-tls` + `stream`), `futures-util` 0.3, `tokio` 1 (with `fs`, `io-util`), `tauri-plugin-fs` 2, `tauri-plugin-http` 2.

---

*End of changes.*
