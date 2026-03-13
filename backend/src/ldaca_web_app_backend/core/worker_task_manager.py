"""
Worker-based Task Manager for managing background jobs using ProcessPoolExecutor.

This replaces the original thread-based TaskManager with a more robust solution
that uses separate processes for heavy computational tasks.
"""

import asyncio
import logging
import multiprocessing as mp
import queue as std_queue
import time
import uuid
from concurrent.futures import Future
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set

from .worker import TASK_REGISTRY, get_worker_pool

logger = logging.getLogger(__name__)


def _is_terminal_task_event(event: Dict[str, Any]) -> bool:
    if event.get("type") != "task_changed":
        return False
    task = event.get("task")
    if not isinstance(task, dict):
        return False
    state = str(task.get("state") or "").lower()
    return state in {"successful", "failed", "cancelled"}


ANALYSIS_TASK_TYPES = {
    "topic_modeling",
    "concordance",
    "token_frequencies",
}


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESSFUL = "successful"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskInfo:
    id: str
    future: Future
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    status: TaskStatus = TaskStatus.PENDING
    result: Any = None
    error: Optional[str] = None
    progress: float = 0.0  # 0..1 for UI progress bars
    progress_message: Optional[str] = None
    task_type: str = ""
    name: str = ""
    user_id: str = ""
    workspace_id: str = ""

    def update_status(self):
        """Update status based on future state."""
        if self.future.cancelled():
            self.status = TaskStatus.CANCELLED
            if not self.finished_at:
                self.finished_at = time.time()
        elif self.future.done():
            if not self.finished_at:
                self.finished_at = time.time()
            try:
                self.result = self.future.result()
                self.status = TaskStatus.SUCCESSFUL
                self.progress = 1.0
                self.progress_message = "Completed"
            except Exception as e:
                self.error = str(e)
                self.status = TaskStatus.FAILED
                self.progress = -1.0  # Indicates failure
                self.progress_message = f"Failed: {str(e)}"
        else:
            # Future is still running
            self.status = TaskStatus.RUNNING
            if not self.started_at:
                self.started_at = time.time()


class WorkerTaskManager:
    """Task manager that uses ProcessPoolExecutor for background jobs."""

    def __init__(self):
        self._tasks: Dict[str, TaskInfo] = {}
        self._lock = asyncio.Lock()
        self._progress_store: Dict[str, Dict[str, Any]] = {}  # task_id -> progress info
        self._mp_manager = mp.Manager()
        self._task_progress_queues: Dict[str, Any] = {}

        # Event bus for real-time updates (single channel per user)
        self._subscribers: Dict[
            str, Set[asyncio.Queue]
        ] = {}  # user_id -> set of queues
        self._subscriber_lock = asyncio.Lock()

    async def subscribe(
        self, user_id: str, workspace_id: Optional[str] = None
    ) -> asyncio.Queue:
        """Subscribe to events for a specific user channel."""
        queue = asyncio.Queue(maxsize=100)  # Bounded to prevent memory leaks
        key = user_id

        async with self._subscriber_lock:
            if key not in self._subscribers:
                self._subscribers[key] = set()
            self._subscribers[key].add(queue)

        logger.debug(f"Subscribed to events for user {user_id}")
        return queue

    async def unsubscribe(
        self, user_id: str, workspace_id: Optional[str], queue: asyncio.Queue
    ):
        """Unsubscribe from events."""
        key = user_id

        async with self._subscriber_lock:
            if key in self._subscribers:
                self._subscribers[key].discard(queue)
                if not self._subscribers[key]:  # Clean up empty sets
                    del self._subscribers[key]

        logger.debug(f"Unsubscribed from events for user {user_id}")
        return queue

    async def emit(self, user_id: str, workspace_id: str, event: Dict[str, Any]):
        """Emit an event to all subscribers for a user channel."""
        key = user_id

        async with self._subscriber_lock:
            if key not in self._subscribers:
                logger.debug(
                    f"No subscribers for user {user_id} - event {event.get('type')} dropped"
                )
                return

            subscriber_count = len(self._subscribers[key])
            logger.debug(
                f"Emitting {event.get('type')} event to {subscriber_count} subscribers for user {user_id}"
            )

            is_terminal = _is_terminal_task_event(event)

            # Send to all subscribers. For terminal task events, prefer replacing
            # one stale queued event before dropping subscriber.
            active_queues = set()
            for queue in self._subscribers[key]:
                try:
                    queue.put_nowait(event)
                    active_queues.add(queue)
                except asyncio.QueueFull:
                    if is_terminal:
                        try:
                            queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                        try:
                            queue.put_nowait(event)
                            active_queues.add(queue)
                        except asyncio.QueueFull:
                            logger.warning(
                                f"Event queue full for user {user_id}, dropping terminal event"
                            )
                    else:
                        logger.warning(
                            f"Event queue full for user {user_id}, dropping event"
                        )
                        # Keep subscriber active; drop only this stale/non-terminal event.
                        active_queues.add(queue)

            self._subscribers[key] = active_queues
            if not self._subscribers[key]:
                del self._subscribers[key]

    def _serialize_task(self, task_info: TaskInfo) -> Dict[str, Any]:
        """Serialize task info for events."""
        return {
            "task_id": task_info.id,
            "task_type": task_info.task_type,
            "name": task_info.name,
            "user_id": task_info.user_id,
            "workspace_id": task_info.workspace_id,
            # Public API field renamed from 'status' -> 'state'
            "state": task_info.status.value,
            "created_at": task_info.created_at,
            "started_at": task_info.started_at,
            "finished_at": task_info.finished_at,
            "progress": task_info.progress,
            "progress_message": task_info.progress_message,
        }

    def _cleanup_progress_queue(self, task_id: str) -> None:
        progress_queue = self._task_progress_queues.pop(task_id, None)
        if progress_queue is None:
            return
        try:
            close = getattr(progress_queue, "close", None)
            if callable(close):
                close()
        except Exception as exc:
            logger.debug("Failed to close progress queue for task %s: %s", task_id, exc)

    async def _consume_worker_progress(
        self,
        task_info: TaskInfo,
        user_id: str,
        workspace_id: str,
        progress_queue: Any,
    ) -> None:
        try:
            while True:
                if task_info.future.done():
                    break

                try:
                    payload = await asyncio.to_thread(progress_queue.get, True, 0.5)
                except std_queue.Empty:
                    continue
                except Exception as exc:
                    logger.debug(
                        "Progress consumer stopped for task %s: %s",
                        task_info.id,
                        exc,
                    )
                    break

                if not isinstance(payload, dict):
                    continue

                raw_progress = payload.get("progress")
                message = payload.get("message")

                try:
                    progress_value = float(raw_progress)
                except TypeError, ValueError:
                    continue

                message_value = str(message) if message is not None else ""
                now = time.time()

                self._progress_store[task_info.id] = {
                    "progress": progress_value,
                    "message": message_value,
                    "updated_at": payload.get("timestamp", now),
                    "source": "real",
                }

                task_info.progress = progress_value
                task_info.progress_message = message_value

                await self.emit(
                    user_id,
                    workspace_id,
                    {
                        "type": "task_changed",
                        "task": self._serialize_task(task_info),
                        "timestamp": now,
                    },
                )

            while True:
                try:
                    payload = await asyncio.to_thread(progress_queue.get_nowait)
                except std_queue.Empty:
                    break
                except Exception:
                    break

                if not isinstance(payload, dict):
                    continue

                raw_progress = payload.get("progress")
                message = payload.get("message")
                try:
                    progress_value = float(raw_progress)
                except TypeError, ValueError:
                    continue

                message_value = str(message) if message is not None else ""
                self._progress_store[task_info.id] = {
                    "progress": progress_value,
                    "message": message_value,
                    "updated_at": payload.get("timestamp", time.time()),
                    "source": "real",
                }
                task_info.progress = progress_value
                task_info.progress_message = message_value
        finally:
            self._cleanup_progress_queue(task_info.id)

    def _reconcile_task_progress(self, task_info: TaskInfo) -> None:
        """Reconcile one task's status and progress with the progress store.

        Used by:
        - `list`
        - `get_task`

        Why:
        - Centralizes shared status/progress normalization so both task queries
          behave identically and avoid duplicated logic.
        """
        task_info.update_status()
        task_id = task_info.id

        # Handle progress based on terminal task status
        if task_info.status in [
            TaskStatus.SUCCESSFUL,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
        ]:
            # For completed tasks, ensure progress store reflects completion
            if task_info.status == TaskStatus.SUCCESSFUL:
                self._progress_store[task_id] = {
                    "progress": 1.0,
                    "message": "Completed successfully",
                    "updated_at": time.time(),
                }
            elif task_info.status == TaskStatus.FAILED:
                self._progress_store[task_id] = {
                    "progress": -1.0,
                    "message": f"Failed: {task_info.error or 'Unknown error'}",
                    "updated_at": time.time(),
                }
            elif task_info.status == TaskStatus.CANCELLED:
                self._progress_store[task_id] = {
                    "progress": -1.0,
                    "message": "Cancelled",
                    "updated_at": time.time(),
                }

        # Use appropriate progress values based on task status
        if task_info.status in [
            TaskStatus.SUCCESSFUL,
            TaskStatus.FAILED,
            TaskStatus.CANCELLED,
        ]:
            # Use values from TaskInfo.update_status() for completed tasks
            pass  # task_info.progress and progress_message are already set by update_status()
        else:
            # Use real progress store for running tasks
            if task_id in self._progress_store:
                progress_info = self._progress_store[task_id]
                task_info.progress = progress_info["progress"]
                task_info.progress_message = progress_info["message"]

    async def _monitor_task_completion(
        self, task_info: TaskInfo, user_id: str, workspace_id: str
    ):
        """Monitor worker completion and persist/emit final task state.

        Used by:
        - `submit_task` background completion monitor

        Why:
        - Centralizes completion side effects (analysis persistence, workspace
          updates, and event emission) in one lifecycle path.
        """
        result_persisted = False

        try:
            # Wait for the task to complete
            result = await asyncio.wrap_future(task_info.future)

            # Update task status
            task_info.update_status()

            # Workers catch exceptions internally and return
            # {"state": "failed", ...} as a normal value, so the future
            # completes without error and update_status() marks SUCCESSFUL.
            # Detect this and override the status.
            if isinstance(result, dict) and result.get("state") == "failed":
                task_info.status = TaskStatus.FAILED
                task_info.error = result.get("error") or result.get(
                    "message", "Worker reported failure"
                )
                task_info.progress = -1.0
                task_info.progress_message = f"Failed: {task_info.error}"

            if task_info.status == TaskStatus.SUCCESSFUL:
                task_type = task_info.task_type

                # Handle DETACH tasks (add node to workspace)
                if task_type in [
                    "concordance_detach",
                    "quotation_detach",
                ]:
                    try:
                        from docworkspace.node.io import from_dict as node_from_dict

                        from .workspace import workspace_manager

                        # Worker contract: {"state": "successful", "result": {...}}
                        if not isinstance(result, dict):
                            raise ValueError(
                                "Detach task result must be a dictionary payload"
                            )

                        data = result.get("result")
                        if not isinstance(data, dict):
                            raise ValueError(
                                "Detach task result missing structured result payload"
                            )

                        node_payload = data.get("node_payload")
                        if not isinstance(node_payload, dict):
                            raise ValueError("Task result missing node_payload")

                        if (
                            workspace_manager.get_current_workspace_id(user_id)
                            != workspace_id
                        ):
                            if not workspace_manager.set_current_workspace(
                                user_id, workspace_id
                            ):
                                raise RuntimeError("Workspace not found")
                        workspace = workspace_manager.get_current_workspace(user_id)
                        if workspace is None:
                            raise RuntimeError("Workspace not found")

                        target_dir = workspace_manager._resolve_workspace_dir(
                            user_id=user_id,
                            workspace_id=workspace_id,
                            workspace_name=workspace.name,
                        )
                        workspace_manager._attach_workspace_dir(workspace, target_dir)
                        workspace_manager._set_working_dir(target_dir)

                        new_node = node_from_dict(node_payload, base_dir=target_dir)
                        workspace.add_node(new_node)
                        workspace.modified_at = datetime.now().isoformat()
                        workspace.save(target_dir)
                        workspace_manager._set_cached_path(
                            user_id, workspace_id, target_dir
                        )

                        result_persisted = True
                        await self.emit(
                            user_id,
                            workspace_id,
                            {
                                "type": "workspace_updated",
                                "task_type": task_type,
                                "task_id": task_info.id,
                                "new_node_id": new_node.id,
                                "timestamp": time.time(),
                            },
                        )

                    except Exception as detach_err:
                        logger.error(
                            f"Failed to finalize detach task {task_info.id}: {detach_err}"
                        )
                        task_info.status = TaskStatus.FAILED
                        task_info.error = str(detach_err)
                        # We must send an update to reflect the failure
                        await self.emit(
                            user_id,
                            workspace_id,
                            {
                                "type": "task_changed",
                                "task": self._serialize_task(task_info),
                                "timestamp": time.time(),
                            },
                        )

                # Handle ANALYSIS tasks (save to TaskManager)
                elif task_type in ANALYSIS_TASK_TYPES:
                    try:
                        # Save the analysis result
                        await self._save_analysis_result(
                            user_id, workspace_id, task_type, task_info, result
                        )
                        result_persisted = True
                    except Exception as save_error:
                        logger.error(
                            f"Failed to save {task_type} result for task {task_info.id}: {save_error}"
                        )

                        # Emit analysis save failure event
                        await self.emit(
                            user_id,
                            workspace_id,
                            {
                                "type": "analysis_save_failed",
                                "task_type": task_type,
                                "task_id": task_info.id,
                                "message": f"Failed to save result: {str(save_error)}",
                                "timestamp": time.time(),
                            },
                        )

            # Always emit task_changed for completion with accurate result_persisted flag
            await self.emit(
                user_id,
                workspace_id,
                {
                    "type": "task_changed",
                    "task": self._serialize_task(task_info),
                    "result_persisted": result_persisted,
                    "timestamp": time.time(),
                },
            )

        except Exception as e:
            logger.error(f"Error monitoring task completion for {task_info.id}: {e}")
            task_info.update_status()  # Update with error

            # Emit failure event
            await self.emit(
                user_id,
                workspace_id,
                {
                    "type": "task_changed",
                    "task": self._serialize_task(task_info),
                    "result_persisted": False,
                    "timestamp": time.time(),
                },
            )
        finally:
            self._cleanup_progress_queue(task_info.id)

    async def _save_analysis_result(
        self,
        user_id: str,
        workspace_id: str,
        task_type: str,
        task_info: TaskInfo,
        result: Any,
    ):
        """Persist worker analysis output into analysis task storage.

        Used by:
        - `_monitor_task_completion` for analysis task types

        Why:
        - Keeps worker-result serialization synchronized with TaskManager records.
        """
        try:
            from ..analysis.manager import get_task_manager
            from ..analysis.results import GenericAnalysisResult

            task_manager = get_task_manager(user_id)
            task = task_manager.get_task(task_info.id)
            if task:
                task.complete(GenericAnalysisResult(result))
                task_manager.save_task(task)
                logger.info(
                    f"{task_type} result saved for task {task_info.id} via TaskManager"
                )
            else:
                logger.warning(f"Task {task_info.id} not found in TaskManager")

        except Exception as e:
            logger.error(
                f"Failed to save {task_type} result for task {task_info.id}: {e}"
            )
            raise  # Re-raise to mark task as failed

    async def submit_task(
        self,
        user_id: str,
        workspace_id: str,
        task_type: str,
        task_args: Dict[str, Any],
        task_name: Optional[str] = None,
    ) -> TaskInfo:
        """Submit a worker task, register tracking, and start monitors.

        Used by:
        - analysis and detach API routes through `workspace_manager.get_task_manager`

        Why:
        - Provides a single task lifecycle entry point with event emission.
        """

        if task_type not in TASK_REGISTRY:
            raise ValueError(f"Unknown task type: {task_type}")

        task_func = TASK_REGISTRY[task_type]

        # Create task ID for progress tracking
        task_id = str(uuid.uuid4())

        # Submit task to worker pool with process-safe progress queue
        worker_pool = get_worker_pool()
        if not worker_pool.is_running:
            worker_pool.start()

        progress_queue = self._mp_manager.Queue()

        future = worker_pool.submit_task(
            task_func,
            user_id=user_id,
            workspace_id=workspace_id,
            **task_args,
            progress_callback=None,
            progress_queue=progress_queue,
        )

        task_info = TaskInfo(
            id=task_id,
            future=future,
            status=TaskStatus.RUNNING,
            started_at=time.time(),
            task_type=task_type,
            name=task_name or task_type,
            user_id=user_id,
            workspace_id=workspace_id,
        )

        # Initialize progress tracking
        self._progress_store[task_id] = {
            "progress": 0.0,
            "message": "Task submitted",
            "updated_at": time.time(),
            "source": "real",
        }
        self._task_progress_queues[task_id] = progress_queue

        async with self._lock:
            self._tasks[task_id] = task_info

        # Start monitoring task completion in background
        asyncio.create_task(
            self._monitor_task_completion(task_info, user_id, workspace_id)
        )
        asyncio.create_task(
            self._consume_worker_progress(
                task_info, user_id, workspace_id, progress_queue
            )
        )

        # Emit task_changed event for initial submission
        logger.info(f"Emitting initial task_changed for task {task_info.id}")
        await self.emit(
            user_id,
            workspace_id,
            {
                "type": "task_changed",
                "task": self._serialize_task(task_info),
                "timestamp": time.time(),
            },
        )

        logger.info(
            f"Task {task_info.id} submitted successfully for user {user_id}, workspace {workspace_id}"
        )
        return task_info

    async def cancel_task(self, task_id: str) -> bool:
        """Cancel a task by its ID."""
        async with self._lock:
            task_info = self._tasks.get(task_id)
            if not task_info:
                return False

            if task_info.future.done():
                return False

            success = task_info.future.cancel()
            if success:
                task_info.update_status()
            return success

    async def cancel_all(
        self,
        *,
        task_type: Optional[str] = None,
        user_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> int:
        """Cancel all tasks matching the given filters."""
        count = 0
        async with self._lock:
            for task_info in list(self._tasks.values()):
                # Apply filters
                if task_type and task_info.task_type != task_type:
                    continue
                if user_id and task_info.user_id != user_id:
                    continue
                if workspace_id and task_info.workspace_id != workspace_id:
                    continue

                if not task_info.future.done():
                    if task_info.future.cancel():
                        task_info.update_status()
                        count += 1
        return count

    async def list(
        self, *, user_id: Optional[str] = None, workspace_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List tasks with normalized progress fields for API consumption.

        Used by:
        - task listing/status API endpoints

        Why:
        - Keeps UI state queries independent of raw `Future` internals.
        """
        async with self._lock:
            out: List[Dict[str, Any]] = []
            for task_info in self._tasks.values():
                # Apply filters
                if user_id and task_info.user_id != user_id:
                    continue
                if workspace_id and task_info.workspace_id != workspace_id:
                    continue

                self._reconcile_task_progress(task_info)

                d = {
                    "task_id": task_info.id,
                    "task_type": task_info.task_type,
                    "name": task_info.name,
                    "user_id": task_info.user_id,
                    "workspace_id": task_info.workspace_id,
                    "state": task_info.status.value,
                    "created_at": task_info.created_at,
                    "started_at": task_info.started_at,
                    "finished_at": task_info.finished_at,
                    "progress": task_info.progress,
                    "progress_message": task_info.progress_message,
                }
                out.append(d)
            return out

    async def any_running(
        self,
        *,
        task_type: Optional[str] = None,
        user_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> bool:
        """Check if any tasks are running, optionally filtered."""
        async with self._lock:
            for task_info in self._tasks.values():
                # Apply filters
                if task_type and task_info.task_type != task_type:
                    continue
                if user_id and task_info.user_id != user_id:
                    continue
                if workspace_id and task_info.workspace_id != workspace_id:
                    continue

                task_info.update_status()
                if task_info.status == TaskStatus.RUNNING:
                    return True
            return False

    async def latest_by_type(
        self,
        task_type: str,
        *,
        user_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> Optional[TaskInfo]:
        """Get the latest task of a given type, optionally filtered."""
        async with self._lock:
            items = []
            for task_info in self._tasks.values():
                if task_info.task_type != task_type:
                    continue
                if user_id and task_info.user_id != user_id:
                    continue
                if workspace_id and task_info.workspace_id != workspace_id:
                    continue

                task_info.update_status()
                items.append(task_info)

            if not items:
                return None

            items.sort(key=lambda x: x.created_at, reverse=True)
            return items[0]

    async def get_task(self, task_id: str) -> Optional[TaskInfo]:
        """Return one task with current status/progress reconciled.

        Used by:
        - analysis polling endpoints and sync helpers

        Why:
        - Ensures callers receive up-to-date state derived from future + progress
            store data.
        """
        async with self._lock:
            task_info = self._tasks.get(task_id)
            if task_info:
                self._reconcile_task_progress(task_info)

            return task_info

    async def clear_task(self, task_id: str) -> bool:
        """Clear and remove a specific task record by ID."""
        async with self._lock:
            task_info = self._tasks.get(task_id)
            if not task_info:
                return False

            # Cancel the future if it's still running
            if not task_info.future.done():
                task_info.future.cancel()

            # Remove from tracking
            del self._tasks[task_id]
            self._progress_store.pop(task_id, None)
            self._cleanup_progress_queue(task_id)
            return True

    async def clear_tasks(
        self,
        task_type: Optional[str] = None,
        *,
        user_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
    ) -> int:
        """Clear and remove task records, optionally filtered."""
        count = 0
        async with self._lock:
            task_ids_to_remove = []
            for task_id, task_info in self._tasks.items():
                # Apply filters
                if task_type and task_info.task_type != task_type:
                    continue
                if user_id and task_info.user_id != user_id:
                    continue
                if workspace_id and task_info.workspace_id != workspace_id:
                    continue

                if not task_info.future.done():
                    task_info.future.cancel()
                task_ids_to_remove.append(task_id)

            for task_id in task_ids_to_remove:
                del self._tasks[task_id]
                # Clean up progress store
                self._progress_store.pop(task_id, None)
                self._cleanup_progress_queue(task_id)
                count += 1

        return count

    async def cleanup_finished_tasks(self, max_age_seconds: int = 3600):
        """Clean up old finished tasks to prevent memory leaks."""
        current_time = time.time()
        async with self._lock:
            task_ids_to_remove = []
            for task_id, task_info in self._tasks.items():
                task_info.update_status()
                if task_info.status in [
                    TaskStatus.SUCCESSFUL,
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                ]:
                    if (
                        task_info.finished_at
                        and (current_time - task_info.finished_at) > max_age_seconds
                    ):
                        task_ids_to_remove.append(task_id)

            for task_id in task_ids_to_remove:
                del self._tasks[task_id]
                self._progress_store.pop(task_id, None)
                self._cleanup_progress_queue(task_id)
                self._progress_store.pop(task_id, None)
                self._cleanup_progress_queue(task_id)
                self._cleanup_progress_queue(task_id)
