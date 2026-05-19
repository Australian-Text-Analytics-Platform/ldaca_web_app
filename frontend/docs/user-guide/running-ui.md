# Running the Frontend UI

**Scope statement:** This guide explains how to run the React frontend locally.

## Step 1 — Install dependencies

**Question:** *Where do I run `pnpm install`?*

**Answer:** Run `pnpm install` from the `ldaca_web_app/` repo root so the root lockfile installs the frontend workspace package.

## Step 2 — Start the dev server

**Question:** *How do I start the UI?*

**Answer:** Run the dev server from the workspace root. The UI defaults to port 3000 unless configured otherwise.

## Step 3 — Connect to the backend

**Question:** *How does the UI find the backend?*

**Answer:** The frontend auto‑detects the backend base URL. You can override it using `VITE_BACKEND_API_BASE` if needed.

## Recap

**Question:** *What should I read next?*

**Answer:** Use the app tour to learn the UI, or jump to the architecture page if you are extending the frontend.
