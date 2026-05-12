# Multi-user safety audit and fix plan

**Date**: 2026-05-11
**Context**: Preparing the backend for the multi-user CILogon-OIDC deployment at `analytics.ldaca.edu.au`. The app currently runs single-user locally; the same code path serves multi-user in production. This document captures a read-only audit of the request surface and an ordered fix plan.

**Scope**: cross-user isolation, request scoping, ownership checks, and concurrency races. Out of scope: TLS configuration, dependency CVEs, frontend state leakage, and the `_exec_polars_expr` AST allowlist beyond a note.

---

## 1. Baseline — what isolation is already in place

Per-user state is consistently keyed off `current_user["id"]`, which is resolved through one FastAPI dependency in [core/auth.py:16](../../backend/src/ldaca_web_app/core/auth.py). In single-user mode it returns the configured root user; in multi-user mode it validates a bearer token against the SQL session table ([db.py:226](../../backend/src/ldaca_web_app/db.py)).

| State | Location | Key |
| --- | --- | --- |
| Filesystem layout | [core/utils.py:48](../../backend/src/ldaca_web_app/core/utils.py) | `<data_root>/users/user_<uid>/{user_data,user_workspaces,user_cache}` |
| `WorkspaceManager._current`, `_task_managers`, `_paths` | [core/workspace.py:34-39](../../backend/src/ldaca_web_app/core/workspace.py) | `user_id` or `(user_id, workspace_id)` |
| Analysis task store | [analysis/manager.py:20](../../backend/src/ldaca_web_app/analysis/manager.py) | `Dict[user_id, TaskManagerStore]` |
| Worker task manager | [core/workspace.py:271](../../backend/src/ldaca_web_app/core/workspace.py) | one instance per user, returned by `workspace_manager.get_task_manager(user_id)` |

IDs:

- Workspace IDs: UUID4 ([core/utils.py:420](../../backend/src/ldaca_web_app/core/utils.py))
- Task IDs: UUID4 ([analysis/manager.py:90](../../backend/src/ldaca_web_app/analysis/manager.py), [worker_task_manager.py:716](../../backend/src/ldaca_web_app/core/worker_task_manager.py))
- Session tokens: `secrets.token_urlsafe(32)` ([db.py:192](../../backend/src/ldaca_web_app/db.py))

There is **no `{workspace_id}` route parameter** — every workspace-touching endpoint resolves the active workspace via `workspace_manager.get_current_workspace_id(user_id)`, which reads per-user implicit state. This avoids one class of cross-user leakage (forged URL paths) but creates a state-race surface (see §2 below).

---

## 2. Findings

Severity scale:
- **high** — exploitable cross-user leakage, RCE-adjacent, or data-corruption under realistic concurrent load
- **med** — exploitable only under specific conditions, or causes silent data loss / inconsistency
- **low** — defense-in-depth, minor information disclosure, or future-proofing

### 2.1 Authentication gaps

| Severity | File | Description |
| --- | --- | --- |
| **high** | [api/config.py:43](../../backend/src/ldaca_web_app/api/config.py) | `POST /api/config/` accepts a `data_root` body with **no `current_user` dependency** and rewrites the process-wide `DATA_ROOT` env var + reloads settings. Unauthenticated client can move every user's data root. |
| low | [api/config.py:25](../../backend/src/ldaca_web_app/api/config.py) | `GET /api/config/` is unauthenticated and exposes the Google client ID + data root path. |

### 2.2 Path traversal / cross-user file access

| Severity | File | Description |
| --- | --- | --- |
| **high** | [api/workspaces/base.py:422](../../backend/src/ldaca_web_app/api/workspaces/base.py) | `add_node_to_workspace` does `file_path = user_data_folder / filename` with no `validate_file_path` check. A `filename=../user_<other>/user_data/secret.csv` escapes the user's folder and loads another user's data into the caller's workspace. |
| **high** | [api/files.py:446](../../backend/src/ldaca_web_app/api/files.py) | `upload_file` writes `file_path = data_folder / file.filename` with no `validate_file_path` check. A multipart filename containing `..` writes outside the user's data folder. Other endpoints in `api/files.py` *do* validate; this one is the outlier. |
| low | [api/workspaces/lifecycle.py:289-313](../../backend/src/ldaca_web_app/api/workspaces/lifecycle.py) | `download_workspace_artifact` opens `result["artifact_path"]` directly with no check that it lives under the user's data folder. Task lookup is per-user so cross-user reach is blocked; the path is still trusted implicitly. |

### 2.3 Workspace mutation races

The "no `{workspace_id}` route parameter" pattern leans heavily on `workspace_manager._current[user_id]`. Every mutation goes:
`set_current_workspace → mutate workspace → save(target_dir)`. Without locking, concurrent requests for the same user interleave and lose writes or persist mid-mutation state.

| Severity | File | Description |
| --- | --- | --- |
| **high** | [core/workspace.py:140-195](../../backend/src/ldaca_web_app/core/workspace.py) | `set_current_workspace`, `unload_workspace`, `update_workspace`, `delete_workspace` mutate `_current[user_id]` and write workspace folders **without any lock**. Two concurrent requests for the same user (e.g. in-flight `add_node` mid-`update_workspace` plus a `POST /workspaces/current` switch) can interleave save/load and persist the wrong workspace contents or load an empty one. |
| med | [api/workspaces/base.py:487-489](../../backend/src/ldaca_web_app/api/workspaces/base.py) | `add_node_to_workspace` does "if current workspace id changed, switch back to original" without any lock; two interleaved adds each see the other's transient state. |
| **high** | [api/workspaces/utils.py:64-84](../../backend/src/ldaca_web_app/api/workspaces/utils.py) | `update_workspace` does the same pattern with no synchronization. Concurrent saves on the same user clobber each other on disk because `Workspace.save(target_dir)` writes payload files in place. |
| med | [core/workspace.py:165-177](../../backend/src/ldaca_web_app/core/workspace.py) | `ensure_display_folder_name` renames the workspace folder on disk on every load. If another request is using paths cached in `_paths` from before the rename, the in-flight save targets the stale path. |
| **high** | [core/worker_task_manager.py:420-435](../../backend/src/ldaca_web_app/core/worker_task_manager.py) | `_monitor_task_completion` for `*_detach` tasks runs on the asyncio loop and calls `workspace_manager.set_current_workspace` → `workspace.add_node` → `workspace.save(target_dir)`. This races every HTTP handler that also mutates the workspace. |

### 2.4 Worker-task ownership / leakage

Per-user task-manager scoping closes the cross-user case today. The findings below are defense-in-depth and future-proofing.

| Severity | File | Description |
| --- | --- | --- |
| med | [api/tasks.py:42-96](../../backend/src/ldaca_web_app/api/tasks.py) | `POST /tasks/clear` does **not** verify `task_info.user_id == current_user.id` before clearing, and unconditionally `os.unlink`s `analysis_task.request.materialized_paths` — those paths come from the task record and are never re-validated as being inside the user's data folder. |
| low | [api/tasks.py:99-116](../../backend/src/ldaca_web_app/api/tasks.py) | `POST /tasks/cancel` similarly relies on per-user manager scoping; no explicit user_id match. |
| med | [core/worker_task_manager.py:510-545](../../backend/src/ldaca_web_app/core/worker_task_manager.py) | `_monitor_task_completion` for `*_materialize` reads `parent_task.request.materialized_paths` into a dict, sets one key, writes back. No locking. Two concurrent materialize tasks for different `parent_node_id` on the same parent analysis task lose one of the updates. |

### 2.5 File-system races (per-user, same workspace)

| Severity | File | Description |
| --- | --- | --- |
| **high** | [core/workspace.py:368](../../backend/src/ldaca_web_app/core/workspace.py) | `cws.save(target_dir)` writes workspace files in-place under `data/<workspace>/`. Two concurrent mutating endpoints for the same workspace interleave. Affected endpoints: `add_node`, `cast_node`, `replace_apply`, `delete_node`, `concat_nodes`, `slice_node`, `join_nodes`, `filter_node`, `polars_expression_apply`, `delete_node_column`, `rename_node_column`, `undo`, `redo`, `rename_workspace`, `update_workspace_description`. |
| med | [api/workspaces/utils.py:201-220](../../backend/src/ldaca_web_app/api/workspaces/utils.py) | `stage_dataframe_as_lazy` allocates a parquet path via `_allocate_workspace_data_path` (collision-suffix loop) and then `df.write_parquet(parquet_path)`. Allocation and write are not atomic — two simultaneous `add_node` requests for the same source filename can both pick the same suffix. |
| med | [api/workspaces/lifecycle.py:430-441](../../backend/src/ldaca_web_app/api/workspaces/lifecycle.py) | ZIP upload calls `shutil.rmtree(target_dir, ignore_errors=True)` then `shutil.copytree(extracted_root, target_dir)`. If `target_dir` is the user's currently-loaded workspace and another request triggers a save mid-import, the import wipes the save. |
| low | [core/worker_task_manager.py:539-544](../../backend/src/ldaca_web_app/core/worker_task_manager.py) | `parent_task.updated_at = datetime.now()` then `task_manager.save_task(parent_task)` does read-modify-write on shared analysis-task state without locking. Per-dict ops are GIL-protected but the logical sequence isn't. |

### 2.6 Workspace-vs-task scoping gap

| Severity | File | Description |
| --- | --- | --- |
| low | [api/workspaces/analyses/concordance.py:213](../../backend/src/ldaca_web_app/api/workspaces/analyses/concordance.py), [topic_modeling.py:478](../../backend/src/ldaca_web_app/api/workspaces/analyses/topic_modeling.py), `quotation.py`, `token_frequencies.py`, [ai_annotation.py:342](../../backend/src/ldaca_web_app/api/workspaces/analyses/ai_annotation.py), `sequential_analysis.py` | All call `get_task_manager(user_id).get_task(task_id)` with **no check that the task's `workspace_id` matches the user's current workspace**. Per-user scope holds (not cross-user leakage), but a user can read stale results from a workspace they're no longer viewing. |
| low | [api/workspaces/lifecycle.py:267-275](../../backend/src/ldaca_web_app/api/workspaces/lifecycle.py) | This is the only place the `task_info.workspace_id != workspace_id` → 403 check is applied. Worth applying uniformly. |

### 2.7 Single-user fallback

| Severity | File | Description |
| --- | --- | --- |
| med | [core/utils.py:48-55](../../backend/src/ldaca_web_app/core/utils.py) | `_user_root_folder` returns `user_root` when `settings.multi_user` is **false** regardless of the passed `user_id`. Safe today, but compounds with §2.1: any code path that reads `settings.multi_user` after auth (e.g. config reload via the unauthenticated `/api/config/`) can silently flatten everyone into the same folder. |

### 2.8 Logging / error surface

| Severity | File | Description |
| --- | --- | --- |
| low | [core/workspace.py:153-156](../../backend/src/ldaca_web_app/core/workspace.py), `181-184`; [worker_tasks_download.py:43-46](../../backend/src/ldaca_web_app/core/worker_tasks_download.py); [api/auth.py:72](../../backend/src/ldaca_web_app/api/auth.py) | Logs include full filesystem paths and user_id. Acceptable for operator logs; confirm the deployment doesn't ship logs to end users. |
| low | [api/workspaces/base.py:204-207](../../backend/src/ldaca_web_app/api/workspaces/base.py), `706-708` | `HTTPException(detail=f"... {exc}")` echoes raw exception strings, which sometimes contain resolved filesystem paths (Polars errors do this). |

### 2.9 Code-execution surface (adjacent)

| Severity | File | Description |
| --- | --- | --- |
| med | [api/workspaces/nodes.py:1448](../../backend/src/ldaca_web_app/api/workspaces/nodes.py) | `_exec_polars_expr` calls `exec()` on user-supplied code after AST validation in [core/polars_expr_validator.py](../../backend/src/ldaca_web_app/core/polars_expr_validator.py). AST allowlist is reasonable, but `exec` of user input is always one missed AST node away from RCE. Not a multi-user isolation issue (each user can already run polars on their own data), but in multi-user a successful escape gives access to the host process and every user's on-disk data. Review the allowlist before public deployment. |

### 2.10 Minor / cleanup

| Severity | File | Description |
| --- | --- | --- |
| low | [core/workspace.py:407-408](../../backend/src/ldaca_web_app/core/workspace.py) | `workspace_manager = WorkspaceManager()` is constructed **twice**. Second instance immediately replaces the first; harmless module-level rebind, but indicates a merge artifact. |
| low | [api/workspaces/lifecycle.py:493-494](../../backend/src/ldaca_web_app/api/workspaces/lifecycle.py) | Duplicated `return` statement (dead second line). |

---

## 3. Open questions (resolve before fixing)

1. **Deployment topology.** Is the production server a single uvicorn worker (one Python process, one asyncio loop, in-process `WorkspaceManager` singleton)? If multiple workers or `--workers N`, each process has its own `WorkspaceManager` and SSE event bus — the "at most one workspace per user in memory" invariant breaks, and the save-on-unload pattern silently loses writes when requests land on different workers. The fix plan below assumes single-worker; multi-worker requires a session-store rework.
2. **Background-task / HTTP-handler interleaving model.** `_monitor_task_completion` and `_consume_worker_progress` are started via `asyncio.create_task`. If they run on the same event loop as HTTP handlers (the default), every `await` is a context-switch point — exactly the race surface flagged in §2.3 and §2.5. If a separate loop is intended, that should be documented.
3. **`Workspace.save()` atomicity.** Is the vendored `docworkspace` library writing temp-file + rename, or in-place? Audit assumed in-place. Temp+rename drops several §2.5 findings from high to med (torn reads unlikely, but logical lost-updates remain).
4. **`/api/config/` reachability.** Is it reverse-proxied off the multi-user surface, or directly exposed at `analytics.ldaca.edu.au`? If proxied off, §2.1's first finding drops to low.
5. **Reverse-proxy cookie scope.** CILogon stores `cilogon_state` as a cookie with `samesite="lax"`. Confirm the production reverse proxy preserves cookie path across the `analytics.ldaca.edu.au` origin.

---

## 4. Fix plan

Ordered for cost/benefit: cheap-and-safe first, then the harder concurrency work.

### Phase 1 — Authentication & path traversal (one PR, low risk)

Cuts the unauthenticated and traversal surfaces.

- [ ] **§2.1**: add `current_user: dict = Depends(get_current_user)` to both `/api/config/` endpoints; gate `POST` behind `current_user.is_admin` (or remove the endpoint entirely if it's debug-only — confirm with deployment plan).
- [ ] **§2.2**: call `validate_file_path` in `add_node_to_workspace` ([api/workspaces/base.py:422](../../backend/src/ldaca_web_app/api/workspaces/base.py)) and `upload_file` ([api/files.py:446](../../backend/src/ldaca_web_app/api/files.py)) before joining the user-supplied filename. Pattern already exists elsewhere in `api/files.py` — copy it.
- [ ] **§2.2 (defense-in-depth)**: add a `_validate_within_user_root(path, user_id)` helper and apply to `download_workspace_artifact`.

**Verification**: add integration tests that POST `filename="../foo"` to both upload endpoints and expect 400. Add a test for unauthenticated `POST /api/config/` returning 401.

### Phase 2 — Task ownership defense-in-depth (one PR, low risk)

Closes the §2.4 / §2.6 gaps even though they're not exploitable today, so the next refactor doesn't accidentally regress.

- [ ] **§2.4**: in `POST /tasks/clear` and `POST /tasks/cancel` ([api/tasks.py](../../backend/src/ldaca_web_app/api/tasks.py)), assert `task_info.user_id == current_user["id"]` before mutation. Before `os.unlink`, validate each path is inside the user's data folder using the helper from Phase 1.
- [ ] **§2.6**: extract the existing `task_info.workspace_id != workspace_id` check from [lifecycle.py:267-275](../../backend/src/ldaca_web_app/api/workspaces/lifecycle.py) into a shared dependency and apply uniformly to every analysis result endpoint. Same shape as the existing auth dep, returns the validated task or raises 403.
- [ ] **§2.4 (materialize race)**: wrap the read-modify-write of `parent_task.request.materialized_paths` in [worker_task_manager.py:510-545](../../backend/src/ldaca_web_app/core/worker_task_manager.py) in a per-task asyncio lock (kept on the parent_task or in a `Dict[task_id, Lock]` on the manager).

### Phase 3 — Per-user mutation lock (one PR, medium risk)

The §2.3 / §2.5 races are the most consequential class of findings. The minimum-viable fix is one asyncio lock per user, taken around every workspace-mutation flow.

- [ ] Add `WorkspaceManager._user_locks: Dict[str, asyncio.Lock]` plus a `_get_user_lock(user_id) -> Lock` helper that lazily creates and returns the lock.
- [ ] Add an `async with workspace_manager.user_lock(user_id):` wrapper around every mutating endpoint and around `_monitor_task_completion`'s `set_current_workspace → add_node → save` sequence.
- [ ] Group the wrap-points into a single dependency (`require_workspace_lock`) so future endpoints get it by default.

**Why per-user, not per-workspace**: the "current workspace" implicit state is per-user, so a per-workspace lock doesn't cover the `set_current_workspace` race. Per-user is coarser than ideal but matches the existing invariant.

**Cost**: serialises all mutations for one user. Acceptable — each user is typically issuing one mutation at a time; the worker-detach race is the only frequent contender.

**Verification**: add a stress test that fires concurrent `add_node` + `delete_node` for one user and asserts the final workspace is internally consistent. Also re-run the existing test suite under `--workers 1` (already the default) to confirm no regressions.

### Phase 4 — Atomic file writes (depends on docworkspace audit)

Open question 3 needs to be answered first. If `docworkspace.Workspace.save()` is in-place, switch it to write-and-rename inside the library. If it's already atomic, this phase is a no-op.

- [ ] Audit `docworkspace.Workspace.save()`; if in-place, change to `tempfile + os.replace`.
- [ ] Apply the same pattern to `stage_dataframe_as_lazy` ([api/workspaces/utils.py:201-220](../../backend/src/ldaca_web_app/api/workspaces/utils.py)): write to a uuid-named temp file, then `os.replace` to the target.

### Phase 5 — Logging hygiene & cleanup (one PR, trivial)

- [ ] **§2.8**: strip user_id and filesystem paths from log lines reachable by user error responses. Keep them in operator logs only.
- [ ] **§2.10**: remove the duplicated `workspace_manager = WorkspaceManager()` and the dead `return`.

### Phase 6 — `_exec_polars_expr` allowlist review (separate effort)

Out of scope for multi-user isolation per se, but flagged because the blast radius changes in multi-user. Schedule a focused security review of [core/polars_expr_validator.py](../../backend/src/ldaca_web_app/core/polars_expr_validator.py) before the public deployment — at minimum, confirm no attribute access reaches into builtins, `__class__`, `__mro__`, `__subclasses__`, or `pl.utils.no_default`. Consider a deny-by-default whitelist of polars expression methods rather than allow-by-default.

---

## 5. Out of scope (flagged for later)

- **Auth flow** itself — bearer token validation, CILogon callback handling, session token rotation. The session token entropy and lookup are fine ([db.py:192](../../backend/src/ldaca_web_app/db.py)); rotation policy on long-lived sessions is a deployment-time decision.
- **Quotas and rate limiting** — the audit didn't look at per-user resource caps. Multi-user deployment should bound concurrent analysis tasks per user and total disk usage per user.
- **Frontend** — local state, query cache scoping, and SSE event filtering are a separate review.
