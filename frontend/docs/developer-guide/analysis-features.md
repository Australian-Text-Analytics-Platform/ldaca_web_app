# Analysis Feature Patterns

**Scope statement:** This page summarizes the shared patterns used by analysis tabs.

## 1) Shared analysis helpers

**Question:** *Which helpers should new analysis tabs reuse?*

**Answer:** Use the shared utilities in `src/features/analysis/common` (hydration, lock state, color palette, node column options).

## 2) Task lifecycle

**Question:** *How should tabs handle background tasks?*

**Answer:** Store `task_id` from the backend response, subscribe to the task stream (SSE), and refresh results **only when a task reaches a terminal state and the tab is active**. Polling is intentionally disabled; the task stream is the source of truth.

## 3) Results persistence

**Question:** *How do I keep results after refresh?*

**Answer:** Use the backend’s `current-request` and `current-result` endpoints and hydrate state when the tab becomes active.

## Recap

**Question:** *What should I check before shipping a new tab?*

**Answer:** Confirm the tab follows the container‑view pattern, uses shared analysis helpers, and handles task cancellation via `task_id`.
