# Workspace Hooks Walkthrough

Welcome! This walkthrough explains how the workspace state flows through the LDaCA frontend. We will build intuition from scratch, so no prior React or Zustand experience is required.

---

## Why do we wrap the app with `WorkspaceProvider`?

The provider is a friendly helper that keeps all workspace data, selection, status, and actions in one predictable place. When the app renders, `WorkspaceProvider` creates four carefully prepared bundles and shares them with its children through React context.

```tsx
import { WorkspaceProvider } from '../providers/WorkspaceProvider';

export function AppShell() {
  return (
    <WorkspaceProvider>
      {/* every workspace-aware component lives here */}
    </WorkspaceProvider>
  );
}
```

- **Data bundle**: Current workspace, nodes, and helper utilities (like `getNodeShape`).
- **Selection bundle**: Which nodes are selected and pagination helpers for the data table.
- **Status bundle**: Loading flags and error state.
- **Action bundle**: All operations that change workspace state (rename, save, select nodes, and so on).

---

## How do we read each slice safely?

Each slice has a dedicated hook. Using them keeps components small and avoids accidental re-renders.

| Question | Answer |
| --- | --- |
| "How do I read workspace metadata?" | Use `useWorkspaceData()` to access `workspaces`, `currentWorkspace`, `workspaceGraph`, `nodeData`, and helpers such as `getNodeShape`. |
| "How do I respond to user selections?" | Reach for `useWorkspaceSelection()`. It provides `selectedNode`, `selectedNodes`, `selectedNodeIds`, and pagination callbacks (`handlePageChange`, `handlePageSizeChange`). |
| "How do I check load state or errors?" | Call `useWorkspaceStatus()` for `isLoading` and `errors`. |
| "How do I trigger workspace mutations?" | Use `useWorkspaceActions()` to run operations such as `createWorkspace`, `saveWorkspace`, `selectNode`, or `toggleNodeSelection`. |

```tsx
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../hooks/useWorkspaceSelection';
import { useWorkspaceStatus } from '../hooks/useWorkspaceStatus';
import { useWorkspaceActions } from '../hooks/useWorkspaceActions';

export function NodeToolbar() {
  const { workspaceGraph } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { isLoading } = useWorkspaceStatus();
  const { saveWorkspace } = useWorkspaceActions();

  return (
    <Toolbar disabled={isLoading}>
      <span>{workspaceGraph.nodes.length} nodes</span>
      <span>{selectedNodeIds.length} selected</span>
      <button onClick={() => saveWorkspace()}>Save</button>
    </Toolbar>
  );
}
```

---

## What happened to the old `useWorkspace` hook?

The monolithic hook used to return a large object with all four slices. That design caused every subscriber to re-render whenever anything changed (selection, status, or actions). We replaced it with slice hooks to keep updates local and to make component intent clearer.

If a component still imports `useWorkspace`, the hook now throws an instructive error:

```ts
export function useWorkspace(): never {
  throw new Error(
    'useWorkspace has been removed. Use the slice hooks (useWorkspaceData, useWorkspaceSelection, useWorkspaceActions, useWorkspaceStatus) instead.',
  );
}
```

That fail-fast behavior acts as a safety net during refactors. Once all teams adopt the slice hooks, we can delete the file entirely.

---

## How do we migrate existing components?

1. **Identify intent**: Decide which data the component really needs—metadata, selection, status, or actions.
2. **Swap imports**: Replace `useWorkspace` with the smallest matching slice hook(s).
3. **Narrow destructuring**: Pull only the fields you need from each slice to keep render logic tidy.
4. **Test interactions**: Exercise node selection, workspace switching, and API calls to confirm the component updates correctly.

Migration example:

```diff
-import { useWorkspace } from '../hooks/useWorkspace';
+import { useWorkspaceData } from '../hooks/useWorkspaceData';
+import { useWorkspaceActions } from '../hooks/useWorkspaceActions';
 
 export function WorkspaceSwitcher() {
-  const { workspaces, setCurrentWorkspace } = useWorkspace();
+  const { workspaces } = useWorkspaceData();
+  const { setCurrentWorkspace } = useWorkspaceActions();
 
   // render dropdown options here
 }
```

---

## What patterns keep the provider happy in the long run?

- Keep slice hooks pure: they only read from context. Side-effects belong in components or dedicated utilities.
- Prefer TanStack Query for server reads and let the actions slice handle mutations plus cache invalidation.
- Memoize expensive derived values inside the provider (as we do with `useMemo`) so that consumers stay fast.
- When adding new workspace behaviors, extend the internal store first, then surface the relevant bits through the smallest slice that needs them.

By following this flow, components stay focused, re-renders shrink, and the workspace UI feels snappier. 🎉
