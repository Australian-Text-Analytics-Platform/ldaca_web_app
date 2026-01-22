# Tutorial: Your First Backend API Call

**Scope statement:** A minimal walkthrough for hitting a backend endpoint once the server is running.

## Step 1 — Pick a simple endpoint

**Question:** *Which endpoint should I test first?*

**Answer:** Use the health or docs endpoint to confirm the server is reachable (see the running‑locally guide).

## Step 2 — Fetch workspace list

**Question:** *How do I request the workspace list?*

**Answer:** Call the `/api/workspaces` endpoint with the appropriate auth headers when multi‑user mode is enabled.

## Step 3 — Interpret the response

**Question:** *What should I look for in the response?*

**Answer:** A list of workspace metadata, including IDs and names. If the list is empty, the backend is working but you have not created a workspace yet.

## Step 4 — Create a workspace

**Question:** *How do I create a workspace?*

**Answer:** Post the workspace name to `/api/workspaces` and store the returned ID for follow‑up calls.

## Recap

**Question:** *What’s the next useful call?*

**Answer:** Load a file as a node via `/api/workspaces/{workspace_id}/nodes/load`, then fetch the graph using `/api/workspaces/{workspace_id}`.
