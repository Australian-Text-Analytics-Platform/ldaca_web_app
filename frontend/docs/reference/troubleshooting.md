# Frontend Troubleshooting

**Scope statement:** Common UI and dev‑server issues and their fixes.

## Backend not ready

**Question:** *Why does the UI say “Backend not ready”?*

**Answer:** Ensure the backend is running and that the frontend is pointing at the correct API base URL.

## Port conflicts

**Question:** *What if port 3000 is already in use?*

**Answer:** Override the dev server port using `FRONTEND_PORT`.

## Context errors

**Question:** *Why do I see provider or context errors?*

**Answer:** Ensure the app is running the production build or that components are wrapped in the appropriate providers.

## Recap

**Question:** *Where do I report persistent issues?*

**Answer:** Open an issue with OS/version details and reproduction steps.
