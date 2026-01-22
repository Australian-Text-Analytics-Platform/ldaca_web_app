# Workspace Hooks (Developer Guide)

**Scope statement:** This page summarizes how workspace state is exposed to the UI.

## 1) Provider model

**Question:** *Why use `WorkspaceProvider`?*

**Answer:** It composes the data, selection, status, and action slices so each component subscribes only to what it needs.

## 2) Slice hooks

**Question:** *Which hooks should I use?*

**Answer:**

- `useWorkspaceData()`
- `useWorkspaceSelection()`
- `useWorkspaceStatus()`
- `useWorkspaceActions()`

## 3) Migration rule

**Question:** *Should I still use the old monolithic hook?*

**Answer:** No. The monolithic hook has been removed to reduce re‑render churn.

## Recap

**Question:** *Where can I see this in action?*

**Answer:** The workspace features under `src/features/workspace` are built entirely on these slice hooks.
