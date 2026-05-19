# Frontend Package Setup (pnpm)

**Scope statement:** This page describes the pnpm package layout used by the web app.

## 1) Layout

**Question:** _How is the web app organized?_

**Answer:** The root `ldaca_web_app/` folder is the pnpm workspace root, with `frontend/` as the pnpm workspace package and `backend/` as a sibling Python project.

## 2) Installing dependencies

**Question:** _Where should I run `pnpm install`?_

**Answer:** Run `pnpm install` from the repo root so the root lockfile installs every pnpm workspace package.

## 3) Running scripts

**Question:** _How do I run a frontend script?_

**Answer:** Use the root wrapper scripts, such as `pnpm dev` or `pnpm build`. For a frontend-only script without a root wrapper, use `pnpm -C frontend <script>`.

## Recap

**Question:** _Where do I find desktop build steps?_

**Answer:** See `user-guide/desktop-build.md` in this docs set.
