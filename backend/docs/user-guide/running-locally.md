# Running the Backend Locally

**Scope statement:** This guide explains how to start the FastAPI backend in development.

## Step 1 — Install dependencies

**Question:** *How do I install backend dependencies?*

**Answer:** Use the workspace’s Python tooling (see project README for exact commands). The backend is designed to run with Python 3.12+.

## Step 2 — Configure environment

**Question:** *Do I need a `.env` file?*

**Answer:** Yes, for local development. Copy `.env.example` to `.env` and adjust values such as `DATABASE_URL` and `USER_DATA_FOLDER`.

## Step 3 — Start the server

**Question:** *How do I run the API in dev mode?*

**Answer:** Use the FastAPI entrypoint command in the backend README. The default port is `8001`.

## Step 4 — Verify health

**Question:** *How do I know the backend is up?*

**Answer:** Open the health or docs endpoint (`/docs` and `/redoc` are enabled by default).

## Recap

**Question:** *What’s next after the server is running?*

**Answer:** Read the configuration and background task references, then try the API tutorial for a first request.
