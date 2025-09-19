"""Task management endpoints for workspace operations.

Separated from base.py during modularization. Provides endpoints to:
- list tasks
- cancel tasks (single or all by type)
- clear task records (single or by type)
- stream task progress via Server-Sent Events
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from ...core.auth import get_current_user
from ...core.workspace import workspace_manager

router = APIRouter(prefix="/workspaces", tags=["workspace-tasks"])


@router.get("/{workspace_id}/tasks")
async def list_workspace_tasks(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    """List tasks for this workspace and current user."""
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    data = await tm.list()
    return {
        "state": "successful",
        "data": data,
        "message": "Tasks retrieved successfully.",
    }


@router.post("/{workspace_id}/tasks/cancel")
async def cancel_workspace_tasks(
    workspace_id: str,
    task_type: Optional[str] = None,
    task_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Cancel tasks for this workspace. If task_id provided, cancel only that task. Otherwise cancel all running tasks, optionally filtered by task_type."""
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    if task_id:
        ok = await tm.cancel_task(task_id)
        return {
            "state": "successful",
            "data": {"cancelled": ok},
            "message": "Task cancelled successfully.",
        }
    count = await tm.cancel_all(task_type=task_type)
    return {
        "state": "successful",
        "data": {"cancelled_count": count},
        "message": "All tasks cancelled successfully.",
    }


@router.post("/{workspace_id}/tasks/clear")
async def clear_workspace_tasks(
    workspace_id: str,
    task_type: Optional[str] = None,
    task_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Clear (remove) task records for this workspace. This only removes task tracking records, not analysis results.

    If task_id provided, clear only that task. Otherwise clear all completed tasks, optionally filtered by task_type.
    Analysis results are preserved and only task records are removed from memory.
    """
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    if task_id:
        cleared = await tm.clear_task(task_id)
        return {
            "state": "successful",
            "data": {"cleared_count": 1 if cleared else 0},
            "message": "Task cleared successfully.",
        }
    count = await tm.clear_tasks(
        task_type=task_type, user_id=user_id, workspace_id=workspace_id
    )
    return {
        "state": "successful",
        "data": {"cleared_count": count},
        "message": "All tasks cleared successfully.",
    }


@router.get("/{workspace_id}/tasks/stream")
async def stream_task_progress(
    workspace_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Server-Sent Events stream for real-time task progress updates."""
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    async def event_generator():
        queue = None
        try:
            # Subscribe to events
            queue = await tm.subscribe(user_id, workspace_id)

            # Send initial tasks snapshot
            tasks = await tm.list(user_id=user_id, workspace_id=workspace_id)
            initial_data = {
                "type": "tasks_snapshot",
                "tasks": tasks,
                "timestamp": time.time(),
            }
            yield f"data: {json.dumps(initial_data)}\n\n"

            # Stream events from queue
            last_heartbeat = time.time()
            while True:
                try:
                    # Wait for event with timeout for heartbeat
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(event)}\n\n"
                    last_heartbeat = time.time()
                except asyncio.TimeoutError:
                    # Send heartbeat to keep connection alive
                    if time.time() - last_heartbeat > 30:
                        heartbeat_data = {"type": "heartbeat", "timestamp": time.time()}
                        yield f"data: {json.dumps(heartbeat_data)}\n\n"
                        last_heartbeat = time.time()

        except asyncio.CancelledError:  # pragma: no cover - stream cancellation
            print(f"SSE stream cancelled for user {user_id}, workspace {workspace_id}")
        except Exception as e:  # pragma: no cover - unexpected stream errors
            print(f"SSE stream error: {e}")
            # Send error event
            error_data = {"type": "error", "message": str(e), "timestamp": time.time()}
            yield f"data: {json.dumps(error_data)}\n\n"
        finally:
            # Unsubscribe on cleanup
            if queue:
                try:
                    await tm.unsubscribe(user_id, workspace_id, queue)
                except Exception as e:
                    print(f"Error unsubscribing from events: {e}")

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


__all__ = ["router"]
