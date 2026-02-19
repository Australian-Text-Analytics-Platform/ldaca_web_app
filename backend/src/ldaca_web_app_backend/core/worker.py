"""
Worker module for heavy computational tasks using ProcessPoolExecutor.

This module provides isolation for CPU-intensive tasks like topic modeling,
avoiding GIL issues and Numba threading conflicts by running work in separate processes.
"""

import multiprocessing as mp
import os
from concurrent.futures import Future, ProcessPoolExecutor
from typing import Any, Dict, Optional

from .worker_tasks_concordance import run_concordance_detach_task
from .worker_tasks_import import run_ldaca_import_task
from .worker_tasks_quotation import run_quotation_detach_task
from .worker_tasks_token import run_token_frequencies_task
from .worker_tasks_topic import run_topic_modeling_task

# Set up optimal process start method for macOS/Unix
# Only set this in the main process to avoid re-execution issues with PyInstaller
if hasattr(mp, "set_start_method"):
    try:
        # Check if we're in the main process
        if mp.current_process().name == "MainProcess":
            mp.set_start_method("spawn", force=True)
    except RuntimeError:
        pass  # Already set


def _configure_worker_environment():
    """Configure safe numeric-library threading settings in worker processes."""
    # Force safe threading configuration from the start
    os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
    os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue omp tbb"
    os.environ["NUMBA_NUM_THREADS"] = "1"


def concordance_detach_task(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
    new_node_name: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Delegate concordance-detach execution to the dedicated task module.

    Used by:
    - `TASK_REGISTRY["concordance_detach"]` via `WorkerTaskManager.submit_task`

    Why:
    - Keeps detach-specific compute/persistence logic out of orchestration code.
    """
    return run_concordance_detach_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        node_id,
        column,
        search_word,
        num_left_tokens,
        num_right_tokens,
        regex,
        case_sensitive,
        new_node_name=new_node_name,
        progress_callback=progress_callback,
    )


def quotation_detach_task(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    engine_config: Dict[str, Any],
    new_node_name: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Delegate quotation-detach execution to the dedicated task module.

    Used by:
    - `TASK_REGISTRY["quotation_detach"]` via `WorkerTaskManager.submit_task`

    Why:
    - Keeps orchestration and quotation extraction logic decoupled.
    """
    return run_quotation_detach_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        node_id,
        column,
        engine_config,
        new_node_name=new_node_name,
        progress_callback=progress_callback,
    )


def token_frequencies_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    token_limit: int = 10,
    stop_words: Optional[list[str]] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Delegate token-frequency execution to the dedicated task module.

    Used by:
    - `TASK_REGISTRY["token_frequencies"]` via `WorkerTaskManager.submit_task`

    Why:
    - Preserves a small orchestration surface while analysis logic evolves.
    """
    return run_token_frequencies_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        node_ids,
        node_columns,
        token_limit=token_limit,
        stop_words=stop_words,
        progress_callback=progress_callback,
    )


def ldaca_import_task(
    user_id: str,
    workspace_id: str,
    url: str,
    filename: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Delegate LDaCA import execution to the dedicated task module.

    Used by:
    - `TASK_REGISTRY["ldaca_import"]` via `WorkerTaskManager.submit_task`

    Why:
    - Keeps import side effects isolated from worker orchestration primitives.
    """
    return run_ldaca_import_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        url,
        filename=filename,
        progress_callback=progress_callback,
    )


def topic_modeling_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    num_topics: int = 10,
    num_words: int = 10,
    custom_stopwords: Optional[list[str]] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Delegate topic-modeling execution to the dedicated task module.

    Used by:
    - `TASK_REGISTRY["topic_modeling"]` via `WorkerTaskManager.submit_task`

    Why:
    - Keeps worker orchestration thin while topic-modeling logic evolves.
    """
    return run_topic_modeling_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        node_ids,
        node_columns,
        num_topics=num_topics,
        num_words=num_words,
        custom_stopwords=custom_stopwords,
        progress_callback=progress_callback,
    )


class WorkerPool:
    """Manages the ProcessPoolExecutor for background tasks."""

    def __init__(self, max_workers: Optional[int] = None):
        """Initialize the worker pool."""
        if max_workers is None:
            # Use number of CPU cores, but cap at 4 to avoid overloading
            max_workers = min(os.cpu_count() or 2, 4)

        self.max_workers = max_workers
        self._pool: Optional[ProcessPoolExecutor] = None
        self._shutdown = False
        self._active_tasks: list[Future] = []  # Track submitted tasks

    def start(self):
        """Start the worker pool lazily when first needed."""
        if self._pool is not None:
            return

        print(f"Starting worker pool with {self.max_workers} processes")
        self._pool = ProcessPoolExecutor(
            max_workers=self.max_workers,
            mp_context=mp.get_context("spawn"),  # Use spawn for better isolation
        )
        self._shutdown = False

    def shutdown(self, wait: bool = True, timeout: float = 5.0):
        """
        Shutdown the worker pool and clean up child processes.

        Args:
            wait: Whether to wait for tasks to complete
            timeout: Maximum time to wait for graceful shutdown (seconds)
        """
        if self._pool is not None:
            print("Shutting down worker pool...")

            # Cancel any pending tasks
            cancelled_count = 0
            for task in self._active_tasks:
                if not task.done():
                    task.cancel()
                    cancelled_count += 1

            if cancelled_count > 0:
                print(f"Cancelled {cancelled_count} pending tasks")

            self._shutdown = True

            # Try graceful shutdown first
            try:
                self._pool.shutdown(wait=wait, cancel_futures=True)
                print("Worker pool shutdown complete")
            except Exception as e:
                print(f"Warning: Error during worker pool shutdown: {e}")

                # Force terminate worker processes if graceful shutdown fails
                try:
                    import os as _os

                    import psutil

                    # Get worker processes
                    parent = psutil.Process(_os.getpid())
                    for child in parent.children(recursive=True):
                        if child.is_running():
                            try:
                                print(f"Force terminating worker process {child.pid}")
                                child.terminate()
                            except psutil.NoSuchProcess, psutil.AccessDenied:
                                pass

                    # Wait briefly then force kill
                    import time

                    time.sleep(0.5)
                    for child in parent.children(recursive=True):
                        if child.is_running():
                            try:
                                child.kill()
                            except psutil.NoSuchProcess, psutil.AccessDenied:
                                pass
                except ImportError:
                    print("Warning: psutil not available for force termination")

            self._pool = None
            self._active_tasks.clear()

    def submit_task(self, task_func: callable, *args, **kwargs) -> Future:
        """Submit a task to the process pool with lazy startup behavior.

        Used by:
        - `WorkerTaskManager.submit_task`

        Why:
        - Centralizes pool lifecycle and task tracking in one place.
        """
        # Lazy initialization: start pool on first task submission
        if self._pool is None and not self._shutdown:
            self.start()

        if self._pool is None:
            raise RuntimeError("Worker pool not started")
        if self._shutdown:
            raise RuntimeError("Worker pool is shutting down")

        future = self._pool.submit(task_func, *args, **kwargs)
        self._active_tasks.append(future)

        # Clean up completed tasks from tracking list
        self._active_tasks = [f for f in self._active_tasks if not f.done()]

        return future

    @property
    def is_running(self) -> bool:
        """Check if the worker pool is running."""
        return self._pool is not None and not self._shutdown

    @property
    def active_task_count(self) -> int:
        """Get the number of active (non-completed) tasks."""
        self._active_tasks = [f for f in self._active_tasks if not f.done()]
        return len(self._active_tasks)


# Global worker pool instance
worker_pool = WorkerPool()


def get_worker_pool() -> WorkerPool:
    """Return the global process-worker pool singleton.

    Used by:
    - `WorkerTaskManager.submit_task`

    Why:
    - Ensures task-manager instances share one process pool.
    """
    return worker_pool


# Task Registry for generic task submission
TASK_REGISTRY = {
    "topic_modeling": topic_modeling_task,
    "concordance_detach": concordance_detach_task,
    "quotation_detach": quotation_detach_task,
    "token_frequencies": token_frequencies_task,
    "ldaca_import": ldaca_import_task,
}
