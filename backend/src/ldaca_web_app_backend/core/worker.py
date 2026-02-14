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
    """Configure environment variables for numeric libraries in worker processes."""
    # Force safe threading configuration from the start
    os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
    os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue omp tbb"
    os.environ["NUMBA_NUM_THREADS"] = "1"
    os.environ["OMP_NUM_THREADS"] = "1"
    os.environ["MKL_NUM_THREADS"] = "1"
    os.environ["OPENBLAS_NUM_THREADS"] = "1"

    print(
        f"[Worker {os.getpid()}] INFO: Using safe workqueue threading (single-threaded)"
    )

    # Try to upgrade to TBB if it's actually available and functional
    tbb_functional = False
    try:
        # Test 1: Check if TBB package is importable
        import tbb  # noqa: F401

        print(f"[Worker {os.getpid()}] INFO: TBB package found")

        # Test 2: Check if Numba can actually use TBB
        try:
            # Try to initialize Numba with TBB temporarily
            try:
                os.environ["NUMBA_THREADING_LAYER"] = "tbb"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "tbb workqueue omp"

                # Test basic numba compilation with TBB
                import numba as nb

                @nb.jit(nopython=True)
                def _test_tbb():
                    return 42

                result = _test_tbb()
                if result == 42:
                    tbb_functional = True
                    print(f"[Worker {os.getpid()}] SUCCESS: TBB threading functional")

            except Exception as e:
                print(f"[Worker {os.getpid()}] WARNING: TBB test failed: {e}")
                # Restore safe settings
                os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue"
                os.environ["NUMBA_NUM_THREADS"] = "1"

        except Exception as e:
            print(f"[Worker {os.getpid()}] WARNING: Numba TBB check failed: {e}")

    except ImportError:
        print(f"[Worker {os.getpid()}] INFO: TBB package not available")

    # If TBB is functional, configure it properly
    if tbb_functional:
        os.environ["NUMBA_THREADING_LAYER"] = "tbb"
        os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "tbb workqueue omp"
        # Don't set NUMBA_NUM_THREADS when using TBB
        if "NUMBA_NUM_THREADS" in os.environ:
            del os.environ["NUMBA_NUM_THREADS"]
        print(f"[Worker {os.getpid()}] INFO: Upgraded to TBB threading layer")
    else:
        print(
            f"[Worker {os.getpid()}] INFO: Using workqueue threading layer (single-threaded)"
        )


def topic_modeling_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    min_topic_size: int = 5,
    use_ctfidf: bool = False,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Thin wrapper delegating topic-modeling execution to a focused module."""
    return run_topic_modeling_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        node_ids,
        node_columns,
        min_topic_size=min_topic_size,
        use_ctfidf=use_ctfidf,
        progress_callback=progress_callback,
    )


def _materialize_to_polars_df(obj):
    import polars as pl

    if isinstance(obj, pl.LazyFrame):
        obj = obj.collect()

    if not isinstance(obj, pl.DataFrame):
        try:
            obj = pl.DataFrame(obj)
        except Exception as exc:
            raise ValueError(
                f"Unable to coerce concordance result into Polars DataFrame: {exc}"
            )
    return obj


def concordance_task(
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    search_word: str,
    num_left_tokens: int = 5,
    num_right_tokens: int = 5,
    regex: bool = False,
    case_sensitive: bool = False,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """
    Execute concordance analysis in a worker process.

    Args:
        user_id: User ID
        workspace_id: Workspace ID
        node_ids: List of node IDs to analyze
        node_columns: Mapping of node_id -> column_name
        search_word: The word or pattern to search for
        num_left_tokens: Number of tokens to the left
        num_right_tokens: Number of tokens to the right
        regex: Whether search_word is a regex
        case_sensitive: Whether search is case sensitive
        progress_callback: Optional callback for progress updates

    Returns:
        Dictionary containing concordance results (DataFrames)
    """
    _configure_worker_environment()

    try:
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(
            f"[Worker {os.getpid()}] Starting concordance task for workspace {workspace_id}"
        )

        if progress_callback:
            progress_callback(0.1, "Initializing workspace...")

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            success = workspace_manager.set_current_workspace(user_id, workspace_id)
            if success:
                workspace = workspace_manager.get_workspace(user_id, workspace_id)

        if not workspace:
            raise ValueError(
                f"Workspace {workspace_id} not found (worker process cannot access workspace)"
            )

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        results = {node_id: {"status": "ready"} for node_id in node_ids}

        if progress_callback:
            progress_callback(1.0, "Completed successfully")

        print(f"[Worker {os.getpid()}] Concordance completed successfully")
        return {"node_results": results}

    except Exception as e:
        print(f"[Worker {os.getpid()}] Concordance failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise


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
    """Thin wrapper delegating concordance-detach execution to a focused module."""
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
    """Thin wrapper delegating quotation-detach execution to a focused module."""
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
    """Thin wrapper delegating token-frequency execution to a focused module."""
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
    """Thin wrapper delegating LDaCA import execution to a focused module."""
    return run_ldaca_import_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        url,
        filename=filename,
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
        """Submit a task to the worker pool. Starts pool lazily if not running."""
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
    """Get the global worker pool instance."""
    return worker_pool


# Task Registry for generic task submission
TASK_REGISTRY = {
    "topic_modeling": topic_modeling_task,
    "concordance": concordance_task,
    "concordance_detach": concordance_detach_task,
    "quotation_detach": quotation_detach_task,
    "token_frequencies": token_frequencies_task,
    "ldaca_import": ldaca_import_task,
}
