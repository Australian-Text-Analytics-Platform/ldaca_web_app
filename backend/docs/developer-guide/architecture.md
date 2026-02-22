# Backend Architecture (Developer Guide)

**Scope statement:** This page summarizes the backend’s main modules and data flow.

## 1) Core responsibilities

**Question:** *What does the backend do?*

**Answer:** It exposes `/api/...` routes that manage workspaces, files, and analysis tasks while keeping all data operations lazy whenever possible.

## 2) Key modules

**Question:** *Which modules matter most?*

**Answer:**

- `api/` — FastAPI routers (workspaces, files, analyses).
- `core/` — orchestration helpers (`workspace_manager`, `docworkspace_data_types`, task manager).
- `settings.py` — Pydantic settings loaded from environment variables.

## 3) Data flow

**Question:** *How does a request become a workspace node?*

**Answer:** The router parses the request, calls DocWorkspace helpers, and serializes the resulting node through `DocWorkspaceDataTypeUtils` before returning JSON to the frontend.

## 4) Lazy contract

**Question:** *Why is laziness important?*

**Answer:** Lazy frames avoid large materializations. Backend helpers (like `stage_dataframe_as_lazy`) persist eager data and reopen it as lazy to keep downstream operations efficient.

## Recap

**Question:** *What should I read next?*

**Answer:** The background task reference explains the process‑based task manager and how to add new tasks.
