## LDaCA Monorepo AI Guide (Web App & Desktop)

- The platform includes `docframe` (Polars-based), `docworkspace` (lazy workspace graph), and the FastAPI + React app (`backend`, `frontend`, `src-tauri`). Preserve document-column metadata end-to-end because the UI renders what `DocWorkspaceAPIUtils` serializes.
- `docframe` and `docworkspace` are lazy-first: wrap text tables in `DocDataFrame`/`DocLazyFrame`, route new data through `stage_dataframe_as_lazy`, and avoid eager collection except at I/O edges.
- FastAPI routers live under `backend/src/ldaca_web_app_backend/api` and must expose only `/api/...` routes; keep routers thin adapters and serialize via `DocWorkspaceAPIUtils`.
- Background analyses always use `WorkerTaskManager` and return `state` plus `metadata.task_id` so the Task Manager can poll/cancel.
- Config comes from `.env` via `config.py` (no hardcoded secrets). Backend dev run: `uv run uvicorn ldaca_web_app_backend.main:app --reload --port 8001` with `PYTHONPATH=src`.
- Frontend assumes the backend at `/api` and uses `VITE_BACKEND_API_BASE` or auto-detection; avoid `localhost` literals (Binder/Colab proxy).
- Workspace interactions must stay lazy; use pagination endpoints and preview APIs instead of collecting frames in routers or UI.
- Tauri/Desktop shells delegate data work to the backend over HTTP; avoid platform-specific filesystem shortcuts.
- User data lives under `backend/data` (configurable via `USER_DATA_FOLDER`); never commit `data/` contents.
- Tests: avoid `pytest .` at repo root. Run docframe tests in `backend/docframe`, backend tests in `backend`, and frontend checks in `frontend`.
- Dependencies: `uv pip install -e .` in backend, `npm install` at root; keep node_modules only at the root. Python minimum is `>=3.14`.

### Detailed instructions

- `.github/instructions/python.instructions.md`
- `.github/instructions/langchain-python.instructions.md`
- `.github/instructions/playwright-python.instructions.md`
- `.github/instructions/security-and-owasp.instructions.md`
- `.github/instructions/performance-optimization.instructions.md`
- `.github/instructions/ai-prompt-engineering-safety-best-practices.instructions.md`
- `.github/instructions/rust-python.instructions.md`
- `.github/instructions/rust.instructions.md`