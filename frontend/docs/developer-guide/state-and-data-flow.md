# State And Data Flow

## API Client

`src/api/http.ts` is the central HTTP wrapper. It builds query strings, handles
JSON and `FormData`, applies timeouts, and normalizes failures into `ApiError`.
Feature API modules should call the shared wrapper instead of using `fetch`
directly.

`src/api/env.ts` resolves the base URL in this order: explicit override,
Tauri-injected `window.__BACKEND_URL__`, Vite environment, backend-injected
base path, local dev backend port, then same-origin.

## TanStack Query

`providers/QueryProvider.tsx` creates a singleton `QueryClient`. Server state
belongs in TanStack Query: workspace lists, graph data, node pages, schemas,
file trees, and analysis result fetches.

Mutation hooks invalidate the relevant query keys after backend changes. Avoid
duplicating server state into Zustand unless it is needed for UI interaction.

## Zustand Stores

The main stores are:

- `authStore`: auth bootstrap, token storage, login/logout, and auth headers.
- `uiStore`: active view, visible views, layout splits, modal state, hints, and
  operation loading flags.
- `selectionStore`: current workspace id and selected node ids.
- `analysisStore`: task list, terminal-state helpers, pending handoffs, and
  materialization events.
- `preferencesStore`: user preferences persisted locally and synced to backend.
- `nodeColorsStore`: committed node colors and per-tab temp colors.

Stores are used for cross-feature UI state, not as a replacement for query
cache.

## Auth Bootstrap

`hooks/useAuth.ts` is the React-facing auth hook. It delegates to `authStore`,
processes redirect tokens, ensures refresh timers, and exposes headers for API
calls. `authStore` coalesces concurrent bootstrap requests to avoid duplicate
auth probes during startup.

## Preferences

`preferencesStore` holds local preferences such as hidden views, favorites,
quotation engine, default language/tokenizer, and demo snapshot visibility.
`usePreferences` initializes the store from `/api/preferences` and debounces
backend sync. View visibility is mirrored into `uiStore`.

## Task Stream

`features/workspace/task-stream/useWorkspaceTaskStreamClient.ts` opens the SSE
connection to `/tasks/stream`. Because `EventSource` cannot send headers, it
passes the auth token as a query parameter when needed.

`useWorkspaceTaskInbox.ts` consumes stream events and updates stores/query
caches. It handles `tasks_snapshot`, `task_changed`, `workspace_updated`,
`analysis_materialized`, heartbeat, and error events. It guards against older
terminal-state events overwriting newer task state.

## Documentation Registry

The help system uses a bundled registry plus optional remote registry. On app
start, `loadRemoteRegistry()` synchronously applies a cached remote payload if
available, then refreshes `${VITE_DOCS_BASE_URL}/registry.json` in the
background. Remote entries shadow bundled entries; bundled entries keep the app
usable offline.
