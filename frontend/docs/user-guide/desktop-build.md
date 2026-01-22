# Desktop Build Overview

**Scope statement:** High‑level steps for building the desktop app (Tauri).

## Step 1 — Prepare backend runtime

**Question:** *Why is a backend runtime needed?*

**Answer:** The desktop app bundles the FastAPI backend, so it needs a packaged runtime before building installers.

## Step 2 — Build the frontend

**Question:** *What frontend artifact does Tauri use?*

**Answer:** The production build output is bundled into the desktop app.

## Step 3 — Build the desktop app

**Question:** *How do I produce the installer?*

**Answer:** Run the desktop build script from the web app workspace root.

## Recap

**Question:** *Where are the detailed backend packaging steps?*

**Answer:** See the backend packaging reference in `ldaca_web_app/backend/docs/reference/packaging.md`.
