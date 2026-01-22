# Frontend Architecture (Developer Guide)

**Scope statement:** This page summarizes the frontend’s architecture and state flow.

## 1) Core stack

**Question:** *Which core libraries are used?*

**Answer:**

- React 19 + TypeScript
- TanStack Query for server state
- Zustand for UI state
- XYFlow for graph rendering

## 2) Feature‑first structure

**Question:** *Where do feature modules live?*

**Answer:** Under `src/features/`, grouped by domain (workspace, preprocessing, analysis).

## 3) State flow

**Question:** *How does workspace state propagate?*

**Answer:** `WorkspaceProvider` composes slice hooks (`useWorkspaceData`, `useWorkspaceSelection`, `useWorkspaceStatus`, `useWorkspaceActions`) so each component subscribes to the smallest state it needs.

## 4) Task updates

**Question:** *How are background task updates delivered?*

**Answer:** The frontend subscribes to the workspace task stream and merges updates into the analysis store for consistent banners and task lists.

## Recap

**Question:** *What should I read next?*

**Answer:** The configuration reference explains environment variables, and the tutorial shows how to add a small feature.
