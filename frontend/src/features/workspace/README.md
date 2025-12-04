# Workspace Features

Workspace-facing UI (graph view, data table, sidebar helpers, task panes) now lives under `src/features/workspace`. Each surface should expose a lightweight container + view, backed by focused hooks/services that compose the shared `useWorkspaceInternal` slices. This keeps React Flow wiring, TanStack Table config, and mutation helpers isolated instead of sitting in thousand-line components.

## Standard layout

```
src/features/workspace/<surface>/
  index.ts                 # Entry point consumed by layout components
  components/              # Presentational pieces (headers, controls, tables)
  hooks/                   # Feature-specific selectors, memoized callbacks
  services/                # Layout helpers, schema transforms, formatters
  README.md                # (optional) surface-specific notes
```

Common helpers such as graph layout utilities, sidebar selectors, and shared table pagination live directly under `src/features/workspace` so both Desktop and Web shells reuse the same primitives.

## Migration checklist

1. **Define the surface boundaries**
   - [ ] List every responsibility of the legacy component (`WorkspaceDataView`, `WorkspaceGraphView`, `WorkspaceSidebar`, etc.).
   - [ ] Map responsibilities to container (data fetching, actions), view (pure rendering), and hooks/services (derived state, memoized callbacks, layout math).
   - [ ] Create the feature skeleton with `components/`, `hooks/`, and `services/` folders.

2. **Extract reusable hooks**
   - [ ] Move logic that currently lives in `useWorkspaceInternal` consumers into dedicated hooks (`useWorkspaceDataTable`, `useWorkspaceGraph`, etc.).
   - [ ] Keep hooks composable: accept the minimal slices from `useWorkspaceInternal` and return props-ready data.
   - [ ] Co-locate expensive helpers (Dagre layout, schema massaging) in `services/` so they can be unit tested without React.

3. **Rebuild containers + views**
   - [ ] Container components connect the hook outputs to the layout shell (Sidebar, Graph pane, Data pane) and handle feature flags.
   - [ ] View components remain dumb; they should only receive props and callbacks.
   - [ ] Prefer shared UI primitives (shadcn, NodeSelectionList, TablePaginationControls) over bespoke markup.

4. **Legacy shim clean-up**
   - [ ] Update `components/layout/*.tsx` to render the new feature entry points (e.g., `<WorkspaceDataTableFeature />`).
   - [ ] Remove obsolete helpers from `src/components/layout` once no longer referenced.

5. **Testing & verification**
   - [ ] Add unit tests for layout/math helpers (graph layout, column summary, pagination reducers).
   - [ ] Run targeted rendering tests for complex views with Testing Library when feasible.
   - [ ] Manually verify workspace flows: node selection, pagination, column operations, graph interactions, and SSE-driven task updates.

6. **Documentation**
   - [ ] Record new hooks/services in `ldaca_web_app/docs/ARCHITECTURE.md` under the Workspace section.
   - [ ] Keep this README updated with any additional conventions (e.g., how to extend graph controls or data-table modals).

Following this process ensures each workspace surface stays modular, testable, and easy to adapt for future layouts (desktop shell, multi-pane lessons, etc.).
