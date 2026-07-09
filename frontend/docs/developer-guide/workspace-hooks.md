# Workspace Hooks

Workspace state is exposed through four slice contexts, all provided by
`WorkspaceProvider`.

## Provider Slices

- `useWorkspaceData()` exposes workspace lists, current workspace metadata,
  graph data, selected node data, and query-derived data.
- `useWorkspaceSelection()` exposes selected node id(s), pagination, sorting,
  and filter state.
- `useWorkspaceStatus()` exposes loading and error state.
- `useWorkspaceActions()` exposes workspace and node mutations.

The slices reduce re-render churn. Components should subscribe only to the
slice they need.

## Internal Composition

`useWorkspaceInternal()` composes three lower-level hooks:

- `useWorkspaceCore()` reads auth headers, selected workspace/node ids,
  pagination state, and UI operation tracking.
- `useWorkspaceQueries()` owns TanStack Query calls for workspace list, current
  workspace, graph, and selected node data.
- `useWorkspaceNodeMutations()` is the action facade. It composes focused
  mutation groups while preserving one `useWorkspaceActions()` surface for
  consumers:
  - `useWorkspaceManagementMutations()` owns current-workspace sync, workspace
    creation/deletion/save, and workspace metadata edits.
  - `useWorkspaceGraphMutations()` owns node rename/copy/delete/history,
    file-backed node creation, join/concat/reorder, and created-node selection.
  - `useWorkspaceTransformMutations()` owns preprocessing apply/preview actions
    and column cast/rename/delete invalidation.
  - `useWorkspaceAnalysisMutations()` owns concordance/quotation search,
    detach, and materialize actions.
  - `workspaceMutationCache.ts`, `workspaceCreatedNodeSelection.ts`, and
    `workspaceSchemaRefresh.ts` hold shared cache, selection, and schema-refresh
    helpers used by those groups. `workspaceMutationLifecycle.ts` builds the
    shared TanStack mutation callbacks for starting operations, ending them on
    success, and recording operation errors after rollback work.

`useWorkspaceUiStateSync()` hydrates and persists backend-owned workspace UI
state through `ui_state.json`; source-node visualization colours are durable
node metadata instead. Analysis views use deterministic palette colours as
defaults, then persist missing or user-picked values through the workspace
node-colour mutation.

## Query Keys And Invalidations

Selected node data is keyed by workspace id, node id, page, page size, sorting,
and filters. Mutations invalidate the narrowest practical set of queries:
graph, node data, workspace summaries, and node-info metadata.

`queryKeys.workspaceGraph()` is the lightweight topology/display query. Full
schema, column, shape, tokenizer-model, and dtype-normalization metadata comes
from `queryKeys.nodeInfo()` / `queryKeys.nodeInfos()` via
`POST /workspaces/{workspace_id}/nodes:batchGet` with body
`{ "nodes": [...] }`. Analysis selectors and preprocessing subtabs should reuse `useNodeColumnInfos()`,
`nodeInfoQueryOptions()`, or `nodeInfosQueryOptions()` instead of deriving
metadata from graph nodes or table rows.

New mutations should follow the existing invalidation helpers instead of
manually reloading the whole app state.

## Graph Hooks

`graph-view/hooks/useWorkspaceGraph.ts` converts backend graph payloads to
React Flow state. It handles dagre layout, node identity/name/document/colour
display state, undo/redo flags, selection/active visual state, fresh-node
highlighting, and React Flow state updates. It does not own schema, column,
shape, or tokenizer metadata; those live behind the node-info query.

The graph hook uses signatures and `requestAnimationFrame` to avoid rewriting
React Flow state on every render.

## Table Hooks

`data-view/hooks/useWorkspaceDataTable.ts` maps node data to TanStack Table
state. Sorting and filters feed back into the selected node data query key.
Column cast, rename, delete, refresh, and query-plan actions all route through
workspace actions.

`data-view/hooks/useColumnMutations.ts` owns the reducer-backed UI state for
WorkspaceTable column headers: dtype casting, datetime-format confirmation,
inline rename, delete confirmation, sparse per-column busy maps, and schema
refresh after mutations. The delete dialog open state is derived from the
selected column instead of being tracked as a second boolean.

## Manual Memoization Boundary

The repo uses React Compiler. The memoization still present around provider
slice values, table callbacks, graph adapters, and effect dependencies is
intentional because those are identity boundaries for React Context and
external libraries.
