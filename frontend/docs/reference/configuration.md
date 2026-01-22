# Frontend Configuration Reference

**Scope statement:** This page summarizes the environment variables used by the frontend.

## Build‑time variables

**Question:** *Which variables are read by the dev server?*

**Answer:**

- `FRONTEND_PORT` — sets the dev server port.

## Runtime variables

**Question:** *Which variables are available in the browser?*

**Answer:**

- `VITE_BACKEND_PORT` — backend port override.
- `VITE_BACKEND_API_BASE` — full backend URL override.
- `VITE_GOOGLE_CLIENT_ID` — OAuth client ID.

## Auto‑detection behavior

**Question:** *What happens if I set nothing?*

**Answer:** The frontend defaults to localhost in dev and `/api` in production, with JupyterHub/Binder proxy detection.

## Recap

**Question:** *Where can I see these in action?*

**Answer:** The running‑UI guide shows how to override ports and base URLs.
