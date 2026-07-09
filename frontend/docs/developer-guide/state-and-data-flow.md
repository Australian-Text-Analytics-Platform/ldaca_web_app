# State And Data Flow

## API Client

Feature code calls the backend through generated hey-api SDK functions or
generated TanStack Query helpers. Raw `fetch` is reserved for browser/Tauri
streaming cases such as file downloads, and those paths should still share
generated endpoint types where practical.

`src/lib/backend/env.ts` resolves the `/api` base URL in this order: explicit
override, Tauri-injected `window.__BACKEND_URL__`, Vite environment,
backend-injected base path, local dev backend port, then same-origin.

`openapi.config.ts` configures hey-api from
`openapi/ldaca-wordflow.openapi.json`. Regenerate the schema and generated SDK
with `pnpm -C frontend openapi:generate` after backend API shape changes. The
generated fetch client uses `src/lib/backend/generatedClientConfig.ts`, which
preserves the existing API base discovery, credentials, auth headers, timeout
behavior, and `ApiError` normalization. Keep `src/api/generated/**` generated
only and excluded from Biome formatting. Handwritten frontend code imports
generated SDK functions, generated TanStack Query helpers, and generated types
through the public `@/api` barrel, not from generated file names directly. When
generated types or SDK functions look wrong, fix the backend route model,
operation name, or OpenAPI export and rerun generation; do not hand-edit
generated files. `src/lib/backend/**` is reserved for runtime infrastructure
such as environment resolution and generated client configuration; backend
request and response contracts should come through `@/api`.

Workspace graph, node-info, node-data, and workspace metadata calls should use
the generated explicit-workspace endpoints when `currentWorkspaceId` is
available. Treat `currentWorkspaceId` as frontend selection state and a cache
key component, not as permission to call hidden-current workspace routes for
workspace-scoped data.
Startup hydration and workspace switching use
`GET/PUT /api/users/me/current-workspace`; that endpoint stores user UI
selection only and should not become a data-read shortcut.

MSW test infrastructure lives under `src/test/msw/` and is enabled from
`src/test/setup.ts`. Add endpoint handlers or per-test `server.use(...)`
overrides for generated-client tests instead of mocking generated modules.

## TanStack Query

`providers/QueryProvider.tsx` creates a singleton `QueryClient`. Server state
belongs in TanStack Query: workspace lists, lightweight graph data, full
node-info metadata, node pages, file trees, and analysis result fetches.

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
- `pinnedNodesStore`: local pin state used by the workspace node list.
- `preprocessingInputsStore`: per-workspace preprocessing subtab inputs.
- `recentSelectionsStore`: recently-used node groups for analysis input presets.

Stores are used for cross-feature UI state, not as a replacement for query
cache.

## URL View State

`uiStore.currentView` still drives feature rendering. `ViewRouteSync` mirrors
that view into TanStack Router search state as `?view=...` and applies validated
incoming view search params when the target view is visible and, for workspace
views, a workspace is loaded. The default `data-loader` view is omitted from the
URL. Keep this as search state rather than path routes so static backend and
Tauri builds continue to reload correctly.

`ViewRouteSync` is also the single owner of invalid-view fallback. If a shared
URL names a workspace view before the workspace id is available, the sync layer
keeps that URL view pending while rendering Data Loader, then adopts it after
the workspace loads. Do not add sidebar-level effects that reset
`currentView`; they can race direct links and leave the URL and rendered view
out of sync.

## Auth Bootstrap

`hooks/useAuth.ts` is the React-facing auth hook. It delegates to `authStore`,
processes redirect tokens, ensures refresh timers, and exposes headers for API
calls. `authStore` coalesces concurrent bootstrap requests to avoid duplicate
auth probes during startup. It reads public auth-mode metadata through generated
`getRuntimeConfig` (`GET /api/runtime-config`) before fetching `/api/auth/`.
Working-directory changes use generated `updateAdminConfig`
(`PATCH /api/admin/config`) from the settings dialog path because mutating the
data root is an admin-scoped server setting, not bootstrap metadata.

## Preferences

`preferencesStore` holds backend-synced preferences such as hidden views,
favorites, LDaCA token, default tokenizer model, whether analysis views show the
multi-tab controls, and the Annotation AI settings (per-provider API keys keyed
by provider id, and user-defined custom providers).
`usePreferences` initializes the store from `/api/preferences` and debounces
backend sync. `SettingsDialog` is the unified preference surface: it edits
backend preferences, working-directory config, and browser-local settings such
as hint enablement/dismissals. Its **AI** tab renders
`AiProvidersPreferencesPanel`, which manages the built-in providers' API keys
(save-on-blur) and lets users add, edit (name + base URL), and delete custom
OpenAI-compatible providers — deleting one also drops its stored key. View
visibility is mirrored into `uiStore`.
When the multi-tab preference is off, a workspace-level cleanup collapses every
persisted analysis tab group in the current workspace to the first tab and
clears tasks owned by removed tabs. `SettingsDialog` checks the current
workspace sidecar before disabling the preference and opens a destructive
confirmation only when that cleanup would remove extra tabs.

Backend persistence is **sparse, VS Code-style**: `save_preferences`
serializes with `exclude_defaults=True` (plus `exclude_none=True`), so the
`preferences.toml` file records only values the user actually changed from the
model defaults. This recurses into nested models, so an all-default
`annotation_ai` section is omitted entirely; missing keys re-hydrate from the
model defaults on the next load.

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
