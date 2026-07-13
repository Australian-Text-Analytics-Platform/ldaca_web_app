# Desktop Build Overview

**Scope statement:** High‑level steps for building the desktop app (Tauri).

## Step 1 — Prepare backend runtime

**Question:** _Why is a backend runtime needed?_

**Answer:** The desktop app bundles the FastAPI backend, so it needs a packaged runtime before building installers.

## Step 2 — Build the frontend

**Question:** _What frontend artifact does Tauri use?_

**Answer:** The production build output is bundled into the desktop app.

## Step 3 — Build the desktop app

**Question:** _How do I produce the installer?_

**Answer:** Run the desktop build script from the web app workspace root. On Windows, this produces the MSI installer.

## Recap

**Question:** _Where are the detailed backend packaging steps?_

**Answer:** See the repository-level
[`desktop runtime runbook`](../../../docs/runbooks/desktop-runtime.md).
