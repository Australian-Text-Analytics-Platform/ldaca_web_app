"""Unified task streaming endpoint.

Provides a single SSE stream for Task Center while preserving scoped action
endpoints under /workspaces/{workspace_id}/tasks/* and /files/tasks/*.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ..core.auth import get_current_user
from ..core.workspace import workspace_manager
from .files import FILES_TASK_SCOPE

router = APIRouter(prefix="/tasks", tags=["task_streaming"])


def _event_scope(workspace_id: str) -> str:
    """Resolve task scope label from workspace identifier.

    Used by:
    - `_annotate_task`
    - `_annotate_event`

    Why:
    - Keeps files-scope vs workspace-scope events distinguishable in one stream.
    """
    return "files" if workspace_id == FILES_TASK_SCOPE else "workspace"


def _annotate_task(task: Dict[str, Any], workspace_id: str) -> Dict[str, Any]:
    """Attach normalized task metadata for SSE consumers.

    Used by:
    - `_annotate_event`
    - initial snapshot generation in `stream_tasks`

    Why:
    - Ensures each task includes scope/workspace hints for Task Center rendering.
    """
    annotated = dict(task)
    metadata = dict((annotated.get("metadata") or {}))
    metadata.setdefault("task_scope", _event_scope(workspace_id))
    metadata.setdefault(
        "workspace_id", None if workspace_id == FILES_TASK_SCOPE else workspace_id
    )
    annotated["metadata"] = metadata
    return annotated


def _annotate_event(event: Dict[str, Any], workspace_id: str) -> Dict[str, Any]:
    """Attach scope metadata to task events and nested task payloads.

    Used by:
    - `stream_tasks`

    Why:
    - Normalizes mixed event payloads from multiple task-manager scopes.
    """
    payload = dict(event)
    scope = _event_scope(workspace_id)

    payload.setdefault("task_scope", scope)
    payload.setdefault(
        "workspace_id", None if workspace_id == FILES_TASK_SCOPE else workspace_id
    )

    if isinstance(payload.get("task"), dict):
        payload["task"] = _annotate_task(payload["task"], workspace_id)

    if payload.get("type") == "tasks_snapshot" and isinstance(
        payload.get("tasks"), list
    ):
        payload["tasks"] = [
            _annotate_task(task, workspace_id)
            for task in payload["tasks"]
            if isinstance(task, dict)
        ]

    return payload


@router.get("/stream")
async def stream_tasks(
    workspace_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Unified SSE stream for task center.

    Includes files-scope tasks and all known workspace scopes for the user.

        Used by:
        - frontend Task Center SSE subscriber

        Why:
        - Consolidates multi-scope task updates into one stream connection.

        Refactor note:
        - Nested helper closures inside endpoint are sizeable; extraction to a small
            streaming service object could improve testability.
    """
    user_id = current_user["id"]

    async def event_generator():
        subscriptions: Dict[str, Dict[str, Any]] = {}

        async def ensure_scope_subscription(scope_id: str):
            if scope_id in subscriptions:
                return
            tm = workspace_manager.get_task_manager(user_id, scope_id)
            queue = await tm.subscribe(user_id, scope_id)
            subscriptions[scope_id] = {"tm": tm, "queue": queue}

        async def refresh_scope_subscriptions():
            scopes = set(workspace_manager.list_user_task_scopes(user_id))
            scopes.add(FILES_TASK_SCOPE)
            if workspace_id:
                scopes.add(workspace_id)

            for scope_id in sorted(scopes):
                await ensure_scope_subscription(scope_id)

        try:
            await refresh_scope_subscriptions()

            combined_tasks = []
            for scope_id, subscription in subscriptions.items():
                tasks = await subscription["tm"].list(
                    user_id=user_id, workspace_id=scope_id
                )
                combined_tasks.extend(
                    _annotate_task(task, scope_id)
                    for task in tasks
                    if isinstance(task, dict)
                )

            snapshot = {
                "type": "tasks_snapshot",
                "tasks": combined_tasks,
                "timestamp": time.time(),
                "task_scope": "all",
            }
            yield f"data: {json.dumps(snapshot)}\n\n"

            last_heartbeat = time.time()

            while True:
                await refresh_scope_subscriptions()

                queue_waiters: Dict[asyncio.Task, str] = {
                    asyncio.create_task(subscription["queue"].get()): scope_id
                    for scope_id, subscription in subscriptions.items()
                }

                if not queue_waiters:
                    await asyncio.sleep(0.5)
                    continue

                done, pending = await asyncio.wait(
                    queue_waiters.keys(),
                    timeout=30.0,
                    return_when=asyncio.FIRST_COMPLETED,
                )

                for pending_task in pending:
                    pending_task.cancel()

                if not done:
                    if time.time() - last_heartbeat > 30:
                        heartbeat = {
                            "type": "heartbeat",
                            "timestamp": time.time(),
                            "task_scope": "all",
                        }
                        yield f"data: {json.dumps(heartbeat)}\n\n"
                        last_heartbeat = time.time()
                    continue

                for completed in done:
                    scope_id = queue_waiters.get(completed)
                    if not scope_id:
                        continue

                    try:
                        event = completed.result()
                    except Exception:
                        continue

                    if not isinstance(event, dict):
                        continue

                    annotated = _annotate_event(event, scope_id)
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
            for scope_id, subscription in subscriptions.items():
                try:
                    await subscription["tm"].unsubscribe(
                        user_id, scope_id, subscription["queue"]
                    )
                except Exception as exc:
                    print(f"Error unsubscribing unified stream {scope_id}: {exc}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control",
        },
    )
