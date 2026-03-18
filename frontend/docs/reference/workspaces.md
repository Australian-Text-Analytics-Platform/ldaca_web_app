# Workspace Setup (npm Workspaces)

**Scope statement:** This page describes the npm workspace layout used by the web app.

## 1) Layout

**Question:** _How is the web app organized?_

**Answer:** The root `ldaca_web_app/` folder is the workspace, with `frontend/` as a workspace member and `ldaca_web_app_backend/` as a sibling project.

## 2) Installing dependencies

**Question:** _Where should I run `npm install`?_

**Answer:** Run it from the workspace root so dependencies are installed for all workspace packages.

## 3) Running scripts

**Question:** _How do I run a workspace script?_

**Answer:** Use `npm run -w frontend <script>` from the root.

## Recap

**Question:** _Where do I find desktop build steps?_

**Answer:** See `user-guide/desktop-build.md` in this docs set.
