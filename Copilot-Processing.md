# Copilot Processing - AI Annotation Refactor

## User Request
Remove the AI-annotator submodule and all backend code that calls into it, in preparation for a clean re-implementation.

## Action Plan

### Phase 1: Remove AI-annotator git submodule ✅
- [x] `git submodule deinit -f backend/ai-annotator`
- [x] `git rm -f backend/ai-annotator`
- [x] Remove `.git/modules/backend/ai-annotator`
- [x] `.gitmodules` entry auto-removed by `git rm`

### Phase 2: Remove backend source files ✅
- [x] Deleted `api/workspaces/analyses/ai_annotation.py` (route handlers)
- [x] Deleted `api/workspaces/analyses/ai_annotation_core.py` (core compute logic + `_classify_texts`)
- [x] Deleted `core/worker_tasks_ai_annotation.py` (worker process tasks)
- [x] Deleted `analysis/implementations/ai_annotation.py` (analysis request schema)
- [x] Deleted `tests/test_ai_annotation_router.py` (test file)

### Phase 3: Remove references in remaining files ✅
- [x] `api/workspaces/__init__.py` — removed `ai_annotation` import and router include
- [x] `core/worker.py` — removed import, `ai_annotation_task`, `ai_annotation_detach_task`, and registry entries
- [x] `core/worker_task_manager.py` — removed `ai_annotation_detach` from detach task type list
- [x] Root `pyproject.toml` — removed `backend/ai-annotator` workspace member and `classifier-fastapi` source
- [x] `backend/pyproject.toml` — removed `classifier-fastapi` dependency and source

### Phase 4: Verify ✅
- [x] `uv lock` succeeded — `classifier-fastapi` + 28 transitive deps removed
- [x] Backend imports cleanly (`from ldaca_web_app_backend.main import app`)
- [x] All 240 tests pass

## What remains (NOT removed)
- **Pydantic models** in `models/__init__.py` (`AiAnnotationRequest`, `AiAnnotationDetachRequest`, etc.) — kept since they define the API contract for the re-implementation
- **Frontend** components (`AiAnnotatorFeature`, sidebar entry, API client, store types) — kept for now, frontend still references these

## Status: Complete — Waiting for next instructions
