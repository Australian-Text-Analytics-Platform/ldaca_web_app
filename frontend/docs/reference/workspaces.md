# Workspace Setup (npm Workspaces)

**Scope statement:** This page describes the npm workspace layout used by the web app.

## 1) Layout

**Question:** *How is the web app organized?*

**Answer:** The root `ldaca_web_app/` folder is the workspace, with `frontend/` as a workspace member and `backend/` as a sibling project.

## 2) Installing dependencies

**Question:** *Where should I run `npm install`?*

**Answer:** Run it from the workspace root so dependencies are installed for all workspace packages.

## 3) Running scripts

**Question:** *How do I run a workspace script?*

**Answer:** Use `npm run -w frontend <script>` from the root.

## Recap

**Question:** *Where do I find desktop build steps?*

**Answer:** See `user-guide/desktop-build.md` in this docs set.
