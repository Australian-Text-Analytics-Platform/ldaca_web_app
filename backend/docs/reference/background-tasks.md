# Background Tasks (WorkerTaskManager)

**Scope statement:** This page explains how long‑running analyses are executed and tracked.

## 1) Why use process tasks?

**Question:** *Why doesn’t the backend run analyses inline?*

**Answer:** CPU‑heavy tasks (topic modeling, token frequencies) run in separate processes to avoid blocking the FastAPI event loop and to bypass the GIL.

## 2) Task lifecycle

**Question:** *What are the main lifecycle stages?*

**Answer:**

1. Submit task via `WorkerTaskManager`.
2. Receive `task_id` in the API response.
3. Stream or poll task status.
4. Persist results to the in‑memory analysis store.

## 3) Client contract

**Question:** *What identifier should clients use for cancel/clear?*

**Answer:** Always use `task_id` for precise cancellation/clearing. `task_type` is only for grouping.

## 4) Adding a new task

**Question:** *How do I add a new background task?*

**Answer:**

- Create a worker function that is picklable.
- Register it in the backend task registry.
- Submit it via the task manager from the relevant router.

## Recap

**Question:** *Where do I see real endpoints?*

**Answer:** The backend architecture page and API tutorial show how task requests are wired into `/api/workspaces/...` routes.
