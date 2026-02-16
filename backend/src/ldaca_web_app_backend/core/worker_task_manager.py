"""
Worker-based Task Manager for managing background jobs using ProcessPoolExecutor.

This replaces the original thread-based TaskManager with a more robust solution
that uses separate processes for heavy computational tasks.
"""

import asyncio
import logging
import time
import uuid
from concurrent.futures import Future
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from .worker import TASK_REGISTRY, get_worker_pool

logger = logging.getLogger(__name__)


TASK_PROGRESS_MESSAGES = {
    "topic_modeling": {
        "loading": "Loading data...",
        "processing": "Processing text data...",
        "generating": "Generating topics...",
        "finalizing": "Finalizing results...",
    },
    "concordance": {
        "loading": "Loading data...",
        "processing": "Searching text...",
        "generating": "Compiling matches...",
        "finalizing": "Formatting results...",
    },
    "token_frequencies": {
        "loading": "Loading data...",
        "processing": "Counting tokens...",
        "generating": "Calculating statistics...",
        "finalizing": "Formatting results...",
    },
    "concordance_detach": {
        "loading": "Loading node data...",
        "processing": "Computing concordance matches...",
        "generating": "Joining with original data...",
        "finalizing": "Creating new workspace node...",
    },
    "quotation_detach": {
        "loading": "Loading node data...",
        "processing": "Extracting quotations...",
        "generating": "Structuring results...",
        "finalizing": "Creating new workspace node...",
    },
    "ldaca_import": {
        "loading": "Connecting to LDaCA...",
        "processing": "Downloading and extracting...",
        "generating": "Converting to DataFrame...",
        "finalizing": "Saving to user data...",
    },
    "default": {
        "loading": "Loading data...",
        "processing": "Processing...",
        "generating": "Analyzing...",
        "finalizing": "Finalizing...",
    },
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
    metadata: Dict[str, Any] = field(default_factory=dict)

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
        self._topic_lazyframe_cache: Dict[tuple[str, str], Dict[str, Any]] = {}
        self._topic_meanings_cache: Dict[str, Dict[str, Any]] = {}

        # Event bus for real-time updates
        self._subscribers: Dict[
            Tuple[str, str], Set[asyncio.Queue]
        ] = {}  # (user_id, workspace_id) -> set of queues
        self._subscriber_lock = asyncio.Lock()

    async def subscribe(self, user_id: str, workspace_id: str) -> asyncio.Queue:
        """Subscribe to events for a specific user and workspace."""
        queue = asyncio.Queue(maxsize=100)  # Bounded to prevent memory leaks
        key = (user_id, workspace_id)

        async with self._subscriber_lock:
            if key not in self._subscribers:
                self._subscribers[key] = set()
            self._subscribers[key].add(queue)

        logger.debug(
            f"Subscribed to events for user {user_id}, workspace {workspace_id}"
        )
        return queue

    async def unsubscribe(self, user_id: str, workspace_id: str, queue: asyncio.Queue):
        """Unsubscribe from events."""
        key = (user_id, workspace_id)

        async with self._subscriber_lock:
            if key in self._subscribers:
                self._subscribers[key].discard(queue)
                if not self._subscribers[key]:  # Clean up empty sets
                    del self._subscribers[key]

        logger.debug(
            f"Unsubscribed from events for user {user_id}, workspace {workspace_id}"
        )
        return queue

    async def emit(self, user_id: str, workspace_id: str, event: Dict[str, Any]):
        """Emit an event to all subscribers for a user/workspace."""
        key = (user_id, workspace_id)

        async with self._subscriber_lock:
            if key not in self._subscribers:
                logger.debug(
                    f"No subscribers for user {user_id}, workspace {workspace_id} - event {event.get('type')} dropped"
                )
                return

            subscriber_count = len(self._subscribers[key])
            logger.debug(
                f"Emitting {event.get('type')} event to {subscriber_count} subscribers for user {user_id}, workspace {workspace_id}"
            )

            # Send to all subscribers, remove any that are full
            active_queues = set()
            for queue in self._subscribers[key]:
                try:
                    queue.put_nowait(event)
                    active_queues.add(queue)
                except asyncio.QueueFull:
                    logger.warning(
                        f"Event queue full for user {user_id}, workspace {workspace_id}, dropping event"
                    )
                    # Don't add to active_queues, will be removed

            self._subscribers[key] = active_queues
            if not self._subscribers[key]:
                del self._subscribers[key]

    def _serialize_task(self, task_info: TaskInfo) -> Dict[str, Any]:
        """Serialize task info for events."""
        return {
            "task_id": task_info.id,
            # Public API field renamed from 'status' -> 'state'
            "state": task_info.status.value,
            "created_at": task_info.created_at,
            "started_at": task_info.started_at,
            "finished_at": task_info.finished_at,
            "progress": task_info.progress,
            "progress_message": task_info.progress_message,
            "metadata": task_info.metadata,
            "task_type": task_info.metadata.get("task_type"),
            "message": task_info.error
            or task_info.progress_message
            or (
                "Task running"
                if task_info.status == TaskStatus.RUNNING
                else "Task finished"
            ),
        }

    def _get_progress_status(
        self, task_type: Optional[str], elapsed: float
    ) -> Tuple[float, str]:
        """Calculate progress and get message based on task type and elapsed time."""
        messages = (
            TASK_PROGRESS_MESSAGES.get(task_type, TASK_PROGRESS_MESSAGES["default"])
            if task_type
            else TASK_PROGRESS_MESSAGES["default"]
        )

        if elapsed < 10:
            # Initial phase (0-20%)
            estimated_progress = 0.2 * (elapsed / 10.0)
            phase_message = messages["loading"]
        elif elapsed < 30:
            # Second phase (20-70%)
            elapsed_in_phase = elapsed - 10
            estimated_progress = 0.2 + 0.5 * (elapsed_in_phase / 20.0)
            phase_message = messages["processing"]
        elif elapsed < 60:
            # Third phase (70-90%)
            elapsed_in_phase = elapsed - 30
            estimated_progress = 0.7 + 0.2 * (elapsed_in_phase / 30.0)
            phase_message = messages["generating"]
        else:
            # Final phase (capped at 90%)
            estimated_progress = 0.9
            phase_message = messages["finalizing"]

        return estimated_progress, phase_message

    async def _progress_ticker(
        self, task_info: TaskInfo, user_id: str, workspace_id: str
    ):
        """Emit periodic task_changed events with simulated progress while running."""
        try:
            # Only run while task is not done
            while not task_info.future.done():
                # Update status first
                task_info.update_status()
                if task_info.status != TaskStatus.RUNNING or not task_info.started_at:
                    break

                # Simulate progress based on elapsed time
                elapsed = time.time() - task_info.started_at
                task_type = task_info.metadata.get("task_type")
                estimated_progress, phase_message = self._get_progress_status(
                    task_type, elapsed
                )

                # Update progress store and task_info
                self._progress_store[task_info.id] = {
                    "progress": estimated_progress,
                    "message": phase_message,
                    "updated_at": time.time(),
                }
                task_info.progress = estimated_progress
                task_info.progress_message = phase_message

                # Emit progress update
                await self.emit(
                    user_id,
                    workspace_id,
                    {
                        "type": "task_changed",
                        "task": self._serialize_task(task_info),
                        "timestamp": time.time(),
                    },
                )

                await asyncio.sleep(1.0)
        except Exception as e:
            logger.warning(f"Progress ticker stopped for task {task_info.id}: {e}")

    async def _monitor_task_completion(
        self, task_info: TaskInfo, user_id: str, workspace_id: str
    ):
        """Monitor task completion and handle result persistence."""
        result_persisted = False

        try:
            # Wait for the task to complete
            result = await asyncio.wrap_future(task_info.future)

            # Update task status
            task_info.update_status()

            if task_info.status == TaskStatus.SUCCESSFUL:
                task_type = task_info.metadata.get("task_type")

                # Handle DETACH tasks (add node to workspace)
                if task_type in ["concordance_detach", "quotation_detach"]:
                    try:
                        import polars as pl

                        from .workspace import workspace_manager

                        # Result contains path and info
                        data = result
                        parquet_path = data.get("parquet_path")
                        new_node_name = data.get("new_node_name")
                        parent_id = data.get("parent_node_id")
                        doc_col = data.get("document_column")

                        if not parquet_path:
                            raise ValueError("Task result missing parquet_path")

                        lazy_df = pl.scan_parquet(parquet_path)

                        parent_node = workspace_manager.get_node_from_workspace(
                            user_id, workspace_id, parent_id
                        )

                        new_node = workspace_manager.add_node_to_workspace(
                            user_id=user_id,
                            workspace_id=workspace_id,
                            data=lazy_df,
                            node_name=new_node_name,
                            operation=task_type,
                            parents=[parent_node] if parent_node else [],
                        )

                        if new_node and doc_col and hasattr(new_node, "set_metadata"):
                            try:
                                new_node.set_metadata("text_column", doc_col)
                            except Exception:
                                pass

                        if new_node:
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
                        else:
                            raise RuntimeError("Failed to add node to workspace")

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
                elif task_type in TASK_REGISTRY:
                    try:
                        # Save the analysis result
                        await self._save_analysis_result(
                            user_id, workspace_id, task_type, task_info, result
                        )
                        result_persisted = True

                        # Emit analysis_saved event ONLY after successful save
                        await self.emit(
                            user_id,
                            workspace_id,
                            {
                                "type": "analysis_saved",
                                "task_type": task_type,
                                "task_id": task_info.id,
                                "timestamp": time.time(),
                            },
                        )
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

    async def _save_analysis_result(
        self,
        user_id: str,
        workspace_id: str,
        task_type: str,
        task_info: TaskInfo,
        result: Any,
    ):
        """Save analysis result to analysis store."""
        try:
            import polars as pl

            from ..analysis.manager import get_task_manager
            from ..analysis.results import GenericAnalysisResult
            from .workspace import workspace_manager

            persisted_result = result
            if task_type == "topic_modeling" and isinstance(result, dict):
                persisted_result = dict(result)
                cache_payload = persisted_result.pop("cache_payload", None)
                topics_payload = persisted_result.get("topics") or []

                if isinstance(topics_payload, list):
                    meanings_records = []
                    for topic in topics_payload:
                        if not isinstance(topic, dict):
                            continue
                        topic_id = topic.get("id")
                        topic_label = topic.get("label")
                        if topic_id is None:
                            continue
                        meanings_records.append({
                            "topic": int(topic_id),
                            "topic_meaning": str(topic_label or ""),
                        })

                    topic_meanings_df = pl.DataFrame(
                        meanings_records,
                        schema={"topic": pl.Int64, "topic_meaning": pl.Utf8},
                    )
                    self._topic_meanings_cache[task_info.id] = {
                        "lazyframe": topic_meanings_df.lazy(),
                        "columns": ["topic", "topic_meaning"],
                    }

                cache_nodes = []
                if isinstance(cache_payload, dict):
                    cache_nodes = cache_payload.get("nodes") or []

                for node_payload in cache_nodes:
                    node_id = node_payload.get("node_id")
                    if not node_id:
                        continue

                    node = workspace_manager.get_node_from_workspace(
                        user_id, workspace_id, node_id
                    )
                    if not node:
                        continue

                    node_data = getattr(node, "data", None)
                    if not isinstance(node_data, pl.LazyFrame):
                        continue

                    embeddings = node_payload.get("embeddings") or []
                    topics = node_payload.get("topics") or []
                    if len(embeddings) != len(topics):
                        raise ValueError(
                            f"Topic cache payload length mismatch for node {node_id}: "
                            f"embeddings={len(embeddings)}, topics={len(topics)}"
                        )

                    source_count_df = node_data.select(
                        pl.len().alias("__n_rows__")
                    ).collect()
                    source_count = (
                        int(source_count_df["__n_rows__"][0])
                        if source_count_df.height
                        else 0
                    )
                    if source_count != len(topics):
                        raise ValueError(
                            f"Topic cache payload row mismatch for node {node_id}: "
                            f"source_rows={source_count}, cached_rows={len(topics)}"
                        )

                    augmented_lf = node_data.with_columns([
                        pl.Series("_tm_embedding", embeddings),
                        pl.Series("_tm_topic", topics, dtype=pl.Int64),
                    ])

                    self._topic_lazyframe_cache[(task_info.id, node_id)] = {
                        "lazyframe": augmented_lf,
                        "node_name": node_payload.get("node_name") or node_id,
                        "text_column": node_payload.get("text_column"),
                        "original_columns": node_payload.get("original_columns")
                        or list(node_data.collect_schema().names()),
                    }

            task_manager = get_task_manager(user_id, workspace_id)
            task = task_manager.get_task(task_info.id)
            if task:
                if task_type == "topic_modeling":
                    task.complete(GenericAnalysisResult(persisted_result))
                else:
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
        metadata: Optional[Dict[str, Any]] = None,
    ) -> TaskInfo:
        """Submit a task to the process pool."""

        if task_type not in TASK_REGISTRY:
            raise ValueError(f"Unknown task type: {task_type}")

        task_func = TASK_REGISTRY[task_type]

        # Create task ID for progress tracking
        task_id = str(uuid.uuid4())

        # Submit task to worker pool without progress callback
        # Progress will be handled differently since callbacks can't be pickled
        worker_pool = get_worker_pool()
        if not worker_pool.is_running:
            worker_pool.start()

        future = worker_pool.submit_task(
            task_func,
            user_id=user_id,
            workspace_id=workspace_id,
            **task_args,
            progress_callback=None,  # Remove progress callback for now
        )

        task_info = TaskInfo(
            id=task_id,
            future=future,
            status=TaskStatus.RUNNING,
            started_at=time.time(),
            metadata={
                "task_type": task_type,
                "name": task_name or task_type,
                "user_id": user_id,
                "workspace_id": workspace_id,
                **(metadata or {}),
            },
        )

        # Initialize progress tracking
        self._progress_store[task_id] = {
            "progress": 0.0,
            "message": "Task submitted",
            "updated_at": time.time(),
        }

        async with self._lock:
            self._tasks[task_id] = task_info

        # Start monitoring task completion in background
        asyncio.create_task(
            self._monitor_task_completion(task_info, user_id, workspace_id)
        )
        # Start progress ticker to emit periodic progress updates
        asyncio.create_task(self._progress_ticker(task_info, user_id, workspace_id))

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
                if task_type and task_info.metadata.get("task_type") != task_type:
                    continue
                if user_id and task_info.metadata.get("user_id") != user_id:
                    continue
                if (
                    workspace_id
                    and task_info.metadata.get("workspace_id") != workspace_id
                ):
                    continue

                if not task_info.future.done():
                    if task_info.future.cancel():
                        task_info.update_status()
                        count += 1
        return count

    async def list(
        self, *, user_id: Optional[str] = None, workspace_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List all tasks, optionally filtered by user_id or workspace_id."""
        async with self._lock:
            out: List[Dict[str, Any]] = []
            for task_info in self._tasks.values():
                # Apply filters
                if user_id and task_info.metadata.get("user_id") != user_id:
                    continue
                if (
                    workspace_id
                    and task_info.metadata.get("workspace_id") != workspace_id
                ):
                    continue

                # Update status from future
                task_info.update_status()

                # Handle progress based on task status
                if task_info.status == TaskStatus.RUNNING and task_info.started_at:
                    # For running tasks, simulate progress based on elapsed time
                    elapsed = time.time() - task_info.started_at
                    task_type = task_info.metadata.get("task_type")
                    estimated_progress, phase_message = self._get_progress_status(
                        task_type, elapsed
                    )

                    # Update or create progress info
                    if task_info.id not in self._progress_store:
                        self._progress_store[task_info.id] = {
                            "progress": estimated_progress,
                            "message": phase_message,
                            "updated_at": time.time(),
                        }
                    else:
                        # Update progress if we don't have real progress data
                        progress_info = self._progress_store[task_info.id]
                        if progress_info["progress"] < estimated_progress:
                            progress_info["progress"] = estimated_progress
                            progress_info["message"] = phase_message
                            progress_info["updated_at"] = time.time()

                elif task_info.status in [
                    TaskStatus.SUCCESSFUL,
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                ]:
                    # For completed tasks, ensure progress store reflects completion
                    if task_info.status == TaskStatus.SUCCESSFUL:
                        self._progress_store[task_info.id] = {
                            "progress": 1.0,
                            "message": "Completed successfully",
                            "updated_at": time.time(),
                        }
                    elif task_info.status == TaskStatus.FAILED:
                        self._progress_store[task_info.id] = {
                            "progress": -1.0,
                            "message": f"Failed: {task_info.error or 'Unknown error'}",
                            "updated_at": time.time(),
                        }
                    elif task_info.status == TaskStatus.CANCELLED:
                        self._progress_store[task_info.id] = {
                            "progress": -1.0,
                            "message": "Cancelled",
                            "updated_at": time.time(),
                        }

                # Always use the values from TaskInfo for completed tasks, progress store for running tasks
                if task_info.status in [
                    TaskStatus.SUCCESSFUL,
                    TaskStatus.FAILED,
                    TaskStatus.CANCELLED,
                ]:
                    # Use values from TaskInfo.update_status() for completed tasks
                    pass  # task_info.progress and progress_message are already set by update_status()
                else:
                    # Use progress store for running tasks
                    if task_info.id in self._progress_store:
                        progress_info = self._progress_store[task_info.id]
                        task_info.progress = progress_info["progress"]
                        task_info.progress_message = progress_info["message"]

                d = {
                    "task_id": task_info.id,
                    "state": task_info.status.value,
                    "created_at": task_info.created_at,
                    "started_at": task_info.started_at,
                    "finished_at": task_info.finished_at,
                    "progress": task_info.progress,
                    "progress_message": task_info.progress_message,
                    "metadata": task_info.metadata,
                    # Back-compat fields used by UI
                    "task_type": task_info.metadata.get("task_type"),
                    "message": task_info.error
                    or task_info.progress_message
                    or (
                        "Task running"
                        if task_info.status == TaskStatus.RUNNING
                        else "Task finished"
                    ),
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
                if task_type and task_info.metadata.get("task_type") != task_type:
                    continue
                if user_id and task_info.metadata.get("user_id") != user_id:
                    continue
                if (
                    workspace_id
                    and task_info.metadata.get("workspace_id") != workspace_id
                ):
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
                if task_info.metadata.get("task_type") != task_type:
                    continue
                if user_id and task_info.metadata.get("user_id") != user_id:
                    continue
                if (
                    workspace_id
                    and task_info.metadata.get("workspace_id") != workspace_id
                ):
                    continue

                task_info.update_status()
                items.append(task_info)

            if not items:
                return None

            items.sort(key=lambda x: x.created_at, reverse=True)
            return items[0]

    async def get_task(self, task_id: str) -> Optional[TaskInfo]:
        """Get a task by its ID."""
        async with self._lock:
            task_info = self._tasks.get(task_id)
            if task_info:
                task_info.update_status()

                # Handle progress based on task status
                if task_info.status == TaskStatus.RUNNING and task_info.started_at:
                    # For running tasks, simulate progress based on elapsed time
                    elapsed = time.time() - task_info.started_at
                    task_type = task_info.metadata.get("task_type")
                    estimated_progress, phase_message = self._get_progress_status(
                        task_type, elapsed
                    )

                    # Update or create progress info
                    if task_id not in self._progress_store:
                        self._progress_store[task_id] = {
                            "progress": estimated_progress,
                            "message": phase_message,
                            "updated_at": time.time(),
                        }
                    else:
                        # Update progress if we don't have real progress data
                        progress_info = self._progress_store[task_id]
                        if progress_info["progress"] < estimated_progress:
                            progress_info["progress"] = estimated_progress
                            progress_info["message"] = phase_message
                            progress_info["updated_at"] = time.time()

                elif task_info.status in [
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
                    # Use progress store for running tasks
                    if task_id in self._progress_store:
                        progress_info = self._progress_store[task_id]
                        task_info.progress = progress_info["progress"]
                        task_info.progress_message = progress_info["message"]

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
            for key in list(self._topic_lazyframe_cache.keys()):
                if key[0] == task_id:
                    del self._topic_lazyframe_cache[key]
            self._topic_meanings_cache.pop(task_id, None)
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
                if task_type and task_info.metadata.get("task_type") != task_type:
                    continue
                if user_id and task_info.metadata.get("user_id") != user_id:
                    continue
                if (
                    workspace_id
                    and task_info.metadata.get("workspace_id") != workspace_id
                ):
                    continue

                if not task_info.future.done():
                    task_info.future.cancel()
                task_ids_to_remove.append(task_id)

            for task_id in task_ids_to_remove:
                del self._tasks[task_id]
                # Clean up progress store
                self._progress_store.pop(task_id, None)
                for key in list(self._topic_lazyframe_cache.keys()):
                    if key[0] == task_id:
                        del self._topic_lazyframe_cache[key]
                self._topic_meanings_cache.pop(task_id, None)
                count += 1

        return count

    def get_topic_lazyframe_cache(
        self, task_id: str, node_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get cached augmented topic-modeling LazyFrame for one node."""
        return self._topic_lazyframe_cache.get((task_id, node_id))

    def list_topic_lazyframe_cache(self, task_id: str) -> Dict[str, Dict[str, Any]]:
        """List cached augmented topic-modeling LazyFrames for a task."""
        out: Dict[str, Dict[str, Any]] = {}
        for (cached_task_id, node_id), payload in self._topic_lazyframe_cache.items():
            if cached_task_id == task_id:
                out[node_id] = payload
        return out

    def get_topic_meanings_cache(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get cached topic-meanings LazyFrame for a topic-modeling task."""
        return self._topic_meanings_cache.get(task_id)

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
                for key in list(self._topic_lazyframe_cache.keys()):
                    if key[0] == task_id:
                        del self._topic_lazyframe_cache[key]
                self._topic_meanings_cache.pop(task_id, None)
