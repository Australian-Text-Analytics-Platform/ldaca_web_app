# Backend API Overview (Reference)

**Scope statement:** A concise overview of the main `/api/...` endpoints.

## Authentication

**Question:** *Which endpoints handle auth?*

**Answer:** `/api/auth/*` routes manage login, session state, and user info.

## Workspaces

**Question:** *How do I list or open workspaces?*

**Answer:** Use `/api/workspaces` for CRUD and `/api/workspaces/{id}` for graph data.

## Nodes

**Question:** *Where do node operations live?*

**Answer:** Node actions are under `/api/workspaces/{id}/nodes/...` (load, filter, select, join, data paging).

## Analysis

**Question:** *Which endpoints trigger analyses?*

**Answer:** Analysis routes live under `/api/workspaces/{id}/...` and return task IDs for long‑running jobs.

## Tasks

**Question:** *How do I cancel or clear tasks?*

**Answer:** Use the workspace task endpoints and always pass `task_id` for precise cancellation.

## Recap

**Question:** *Where is the full OpenAPI spec?*

**Answer:** The FastAPI docs expose the full schema at `/docs` and `/openapi.json`.
