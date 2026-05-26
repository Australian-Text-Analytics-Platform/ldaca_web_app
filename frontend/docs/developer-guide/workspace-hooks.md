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
- `useWorkspaceNodeMutations()` owns workspace creation/opening, node creation,
  transforms, detach/materialize operations, and cache invalidation.

`useWorkspaceUiStateSync()` hydrates and persists workspace UI state such as
node colors through backend `ui_state.json`.

## Query Keys And Invalidations

Selected node data is keyed by workspace id, node id, page, page size, sorting,
and filters. Mutations invalidate the narrowest practical set of queries:
graph, node data, workspace summaries, and schema/column metadata.

New mutations should follow the existing invalidation helpers instead of
manually reloading the whole app state.

## Graph Hooks

`graph-view/hooks/useWorkspaceGraph.ts` converts backend graph payloads to
React Flow state. It handles dagre layout, tokenization metadata, selection/active
visual state, fresh-node highlighting, color pruning, and React Flow state
updates.

The graph hook uses signatures and `requestAnimationFrame` to avoid rewriting
React Flow state on every render.

## Table Hooks

`data-view/hooks/useWorkspaceDataTable.ts` maps node data to TanStack Table
state. Sorting and filters feed back into the selected node data query key.
Column cast, rename, delete, refresh, and query-plan actions all route through
workspace actions.

## Manual Memoization Boundary

The repo uses React Compiler. The memoization still present around provider
slice values, table callbacks, graph adapters, and effect dependencies is
intentional because those are identity boundaries for React Context and
external libraries.
