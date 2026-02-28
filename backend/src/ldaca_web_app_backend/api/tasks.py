"""Unified task endpoints.

Provides a single SSE stream and root task operations for Task Center.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import StreamingResponse

from ..analysis.manager import get_task_manager as get_analysis_task_manager
from ..core.auth import get_current_user
from ..core.workspace import workspace_manager
from .files import USER_TASK_SCOPE

router = APIRouter(prefix="/tasks", tags=["task_streaming"])


@router.get("")
async def list_tasks(
    current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """List tasks for current user."""
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, USER_TASK_SCOPE)
    tasks = await tm.list(user_id=user_id)
    return {
        "state": "successful",
        "data": tasks,
        "message": "Tasks listed successfully.",
    }


@router.post("/clear")
async def clear_tasks(
    task_id: str = Query(...),
    current_user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    """Clear a task and all associated caches by task id.

    If the task is still running it is cancelled first.  Both the worker
    task manager record and the analysis task manager record (including
    the current-task-id mapping) are removed.
    """
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, USER_TASK_SCOPE)

    task_info = await tm.get_task(task_id)
    workspace_id = task_info.metadata.get("workspace_id") if task_info else None

    cleared_worker = await tm.clear_task(task_id)

    cleared_analysis = False
    if workspace_id:
        analysis_tm = get_analysis_task_manager(user_id, workspace_id)
        if analysis_tm.get_task(task_id) is not None:
            analysis_tm.clear_task(task_id)
            cleared_analysis = True

    return {
        "state": "successful",
        "data": {
            "cleared_worker": cleared_worker,
            "cleared_analysis": cleared_analysis,
        },
        "message": "Task cleared successfully.",
    }


def _event_scope(workspace_id: Optional[str]) -> str:
    """Resolve task scope label from workspace identifier.

    Used by:
    - `_annotate_task`
    - `_annotate_event`

    Why:
    - Keeps user-scope vs workspace-scope events distinguishable in one stream.
    """
    return "user" if workspace_id == USER_TASK_SCOPE else "workspace"


def _annotate_task(task: Dict[str, Any]) -> Dict[str, Any]:
    """Attach normalized task metadata for SSE consumers.

    Used by:
    - `_annotate_event`
    - initial snapshot generation in `stream_tasks`

    Why:
    - Ensures each task includes scope/workspace hints for Task Center rendering.
    """
    annotated = dict(task)
    metadata = dict((annotated.get("metadata") or {}))
    meta_workspace_id = metadata.get("workspace_id")
    task_workspace_id = (
        meta_workspace_id
        if isinstance(meta_workspace_id, str)
        else task.get("workspace_id")
    )
    if not task_workspace_id:
        task_workspace_id = USER_TASK_SCOPE

    metadata.setdefault("task_scope", _event_scope(task_workspace_id))
    metadata.setdefault(
        "workspace_id",
        None if task_workspace_id == USER_TASK_SCOPE else task_workspace_id,
    )
    annotated["metadata"] = metadata
    return annotated


def _annotate_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """Attach scope metadata to task events and nested task payloads.

    Used by:
    - `stream_tasks`

    Why:
    - Normalizes mixed event payloads from multiple task-manager scopes.
    """
    payload = dict(event)
    event_workspace_id = payload.get("workspace_id")

    if isinstance(payload.get("task"), dict):
        task_metadata = payload["task"].get("metadata") or {}
        event_workspace_id = task_metadata.get("workspace_id") or event_workspace_id

    if not event_workspace_id:
        event_workspace_id = USER_TASK_SCOPE

    scope = _event_scope(event_workspace_id)

    payload.setdefault("task_scope", scope)
    payload.setdefault(
        "workspace_id",
        None if event_workspace_id == USER_TASK_SCOPE else event_workspace_id,
    )

    if isinstance(payload.get("task"), dict):
        payload["task"] = _annotate_task(payload["task"])

    if payload.get("type") == "tasks_snapshot" and isinstance(
        payload.get("tasks"), list
    ):
        payload["tasks"] = [
            _annotate_task(task) for task in payload["tasks"] if isinstance(task, dict)
        ]

    return payload


async def _get_stream_user(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
):
    """Resolve auth for the SSE stream endpoint.

    Accepts token from the ``Authorization`` header (fetch clients) or a
    ``token`` query parameter (native ``EventSource`` clients that cannot
    set custom HTTP headers).
    """
    if not authorization and token:
        authorization = f"Bearer {token}"
    return await get_current_user(authorization)


@router.get("/stream")
async def stream_tasks(
    current_user: dict = Depends(_get_stream_user),
):
    """Unified SSE stream for task center.

    Includes all user tasks from a single per-user task manager channel.

        - frontend Task Center SSE subscriber

        Why:
        - Consolidates multi-scope task updates into one stream connection.

        Refactor note:
        - Nested helper closures inside endpoint are sizeable; extraction to a small
            streaming service object could improve testability.
    """
    user_id = current_user["id"]

    async def event_generator():
        tm = workspace_manager.get_task_manager(user_id, USER_TASK_SCOPE)
        queue = await tm.subscribe(user_id)

        try:
            tasks = await tm.list(user_id=user_id)
            combined_tasks = [
                _annotate_task(task) for task in tasks if isinstance(task, dict)
            ]

            snapshot = {
                "type": "tasks_snapshot",
                "tasks": combined_tasks,
                "timestamp": time.time(),
                "task_scope": "all",
            }
            yield f"data: {json.dumps(snapshot)}\n\n"

            last_heartbeat = time.time()

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    if time.time() - last_heartbeat > 30:
                        heartbeat = {
                            "type": "heartbeat",
                            "timestamp": time.time(),
                            "task_scope": "all",
                        }
                        yield f"data: {json.dumps(heartbeat)}\n\n"
                        last_heartbeat = time.time()
                    continue

                if not isinstance(event, dict):
                    continue

                annotated = _annotate_event(event)
                yield f"data: {json.dumps(annotated)}\n\n"
                last_heartbeat = time.time()

        except asyncio.CancelledError:  # pragma: no cover
            print(f"Unified SSE stream cancelled for user {user_id}")
        except Exception as exc:  # pragma: no cover
            print(f"Unified SSE stream error: {exc}")
            error_data = {
                "type": "error",
                "message": str(exc),
                "timestamp": time.time(),
                "task_scope": "all",
            }
            yield f"data: {json.dumps(error_data)}\n\n"
        finally:
            try:
                await tm.unsubscribe(user_id, None, queue)
            except Exception as exc:
                print(f"Error unsubscribing unified stream for user {user_id}: {exc}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control",
        },
    )
