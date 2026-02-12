# Backend Configuration Reference

**Scope statement:** This page lists the most important backend environment variables.

## Core settings

**Question:** *Which variables must be set for local development?*

**Answer:** Common defaults work locally, but you should verify:

- `DATABASE_URL`
- `USER_DATA_FOLDER`
- `SERVER_HOST` / `SERVER_PORT`

## Authentication

**Question:** *How do I enable multi‑user mode?*

**Answer:** Enable `MULTI_USER=true` and set `GOOGLE_CLIENT_ID` plus `SECRET_KEY`.

## CORS

**Question:** *How do I add frontend origins?*

**Answer:** Populate `CORS_ALLOWED_ORIGINS_STR` with a comma‑separated list of origins.

## Sample data

**Question:** *Where does sample data live?*

**Answer:** Sample data ships inside the backend package under `resources/sample_data`. You can override this with `SAMPLE_DATA_FOLDER` if you want a filesystem path instead, while `USER_DATA_FOLDER` controls user‑specific copies.

## User data layout

**Question:** *Where are user uploads and workspaces stored?*

**Answer:** The backend creates user‑scoped folders under `USER_DATA_FOLDER` for uploads, workspaces, exports, and caches. Keep the root path configurable for easier migrations.

## Legacy configuration migration

**Question:** *Is the old JSON config still supported?*

**Answer:** No. The backend now expects environment variables, which can be provided by your shell/IDE or any external tooling that loads `.env`. Update any code that still imports legacy JSON configuration.

## Recap

**Question:** *Where can I see these in action?*

**Answer:** The running‑locally guide and the API tutorial reference these settings in context.
