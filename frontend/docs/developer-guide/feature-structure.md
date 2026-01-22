# Frontend Feature Structure

**Scope statement:** This page documents the feature‑first folder conventions used in the frontend.

## 1) Workspace features

**Question:** *Where do workspace UI surfaces live?*

**Answer:** Under `src/features/workspace/` with `components/`, `hooks/`, and `services/` per surface.

## 2) Preprocessing features

**Question:** *How are preprocessing subtabs organized?*

**Answer:** Each subtab lives under `src/features/preprocessing/<subtab>/` and shares preview helpers from `src/features/preprocessing/`.

## 3) Analysis features

**Question:** *Where do analysis tabs live?*

**Answer:** Under `src/features/analysis/<feature>/` with shared helpers in `src/features/analysis/common`.

## Recap

**Question:** *What makes a feature “done”?*

**Answer:** The container owns orchestration, the view is pure, and services expose reusable helpers for API calls and formatting.
