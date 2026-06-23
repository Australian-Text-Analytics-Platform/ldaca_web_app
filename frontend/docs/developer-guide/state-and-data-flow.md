# State And Data Flow

## API Client

`src/api/http.ts` is the legacy low-level HTTP wrapper. It builds query strings,
handles JSON and `FormData`, applies timeouts, and normalizes failures into
`ApiError`. New feature code should call generated hey-api SDK functions or
generated TanStack Query helpers instead of using `fetch` or handwritten
endpoint facades.

`src/api/env.ts` resolves the base URL in this order: explicit override,
Tauri-injected `window.__BACKEND_URL__`, Vite environment, backend-injected
base path, local dev backend port, then same-origin.

`openapi.config.ts` configures hey-api from
`openapi/ldaca-wordflow.openapi.json`. Regenerate the schema and generated SDK
with `pnpm -C frontend openapi:generate` after backend API shape changes. The
generated fetch client uses `src/lib/backend/generatedClientConfig.ts`, which
preserves the existing API base discovery, credentials, auth headers, timeout
behavior, and `ApiError` normalization. Keep `src/api/generated/**` generated
only. `src/lib/backend/**` is reserved for runtime infrastructure such as
environment resolution and generated client configuration; backend request and
response contracts should come from `src/api/generated/types.gen.ts`.

MSW test infrastructure lives under `src/test/msw/` and is enabled from
`src/test/setup.ts`. Add endpoint handlers or per-test `server.use(...)`
overrides for generated-client tests instead of mocking generated modules.

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

## URL View State

`uiStore.currentView` still drives feature rendering. `ViewRouteSync` mirrors
that view into TanStack Router search state as `?view=...` and applies validated
incoming view search params when the target view is visible and, for workspace
views, a workspace is loaded. The default `data-loader` view is omitted from the
URL. Keep this as search state rather than path routes so static backend and
Tauri builds continue to reload correctly.

## Auth Bootstrap

`hooks/useAuth.ts` is the React-facing auth hook. It delegates to `authStore`,
processes redirect tokens, ensures refresh timers, and exposes headers for API
calls. `authStore` coalesces concurrent bootstrap requests to avoid duplicate
auth probes during startup.

## Preferences

`preferencesStore` holds backend-synced preferences such as hidden views,
favorites, LDaCA token, default tokenizer model, and whether analysis views
show the multi-tab controls.
`usePreferences` initializes the store from `/api/preferences` and debounces
backend sync. `SettingsDialog` is the unified preference surface: it edits
backend preferences, working-directory config, and browser-local settings such
as hint enablement/dismissals. View visibility is mirrored into `uiStore`.
When the multi-tab preference is off, a workspace-level cleanup collapses every
persisted analysis tab group in the current workspace to the first tab and
clears tasks owned by removed tabs. `SettingsDialog` checks the current
workspace sidecar before disabling the preference and opens a destructive
confirmation only when that cleanup would remove extra tabs.

## Task Stream

`features/workspace/task-stream/useWorkspaceTaskStreamClient.ts` opens the SSE
connection to `/tasks/stream`. Because `EventSource` cannot send headers, it
passes the auth token as a query parameter when needed.

`useWorkspaceTaskInbox.ts` consumes stream events and updates stores/query
caches. It handles `tasks_snapshot`, `task_changed`, `workspace_updated`,
`analysis_materialized`, heartbeat, and error events. It guards against older
terminal-state events overwriting newer task state.

The sidebar Task Center is observational. It shows the backend task register and
removes cards only when the backend reports removal, either through a snapshot,
`task_removed`, or the clear endpoint response. Workflow controls such as Stop
and Clear Results belong in the owning feature tab so backend recursive cleanup
stays the source of truth for parent and child tasks.

## Documentation Registry

The help system uses a bundled registry plus optional remote registry. On app
start, `loadRemoteRegistry()` synchronously applies a cached remote payload if
available, then refreshes `${VITE_DOCS_BASE_URL}/registry.json` in the
background. Remote entries shadow bundled entries; bundled entries keep the app
usable offline.
