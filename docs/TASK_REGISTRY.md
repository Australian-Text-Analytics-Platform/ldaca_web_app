# Task Registry & Process Management

The LDaCA Web App Backend uses a **Process-based Task Manager** to handle heavy computational tasks (like Topic Modeling) asynchronously. This system ensures that CPU-intensive operations do not block the main FastAPI event loop and avoids Python's Global Interpreter Lock (GIL) limitations.

## Architecture

### Components

1. **`ProcessTaskManager`** (`core/process_task_manager.py`):
    * The central orchestrator.
    * Manages task lifecycle (submission, monitoring, completion).
    * Handles real-time progress updates via `emit()`.
    * Persists results to the `analysis_store`.

2. **`WorkerPool`** (`core/worker.py`):
    * Wraps Python's `concurrent.futures.ProcessPoolExecutor`.
    * Manages a pool of worker processes (default: CPU count, capped at 4).
    * Ensures worker processes are initialized correctly (e.g., using `spawn` on macOS).

3. **`TASK_REGISTRY`** (`core/worker.py`):
    * A dictionary mapping task names (e.g., `"topic_modeling"`) to their corresponding functions.
    * **To add a new task, you must register it here.**

### Lifecycle

1. **Submission**:
    * API Endpoint calls `tm.submit_task(task_type="...", task_args={...})`.
    * `ProcessTaskManager` looks up the function in `TASK_REGISTRY`.
    * The task is submitted to the `WorkerPool`.
    * A `TaskInfo` object is created with status `RUNNING`.

    **Client contract**: the backend assigns a unique `task_id` for every submission. The UI should treat `task_id` as the canonical identifier for follow-up operations (refresh, cancel, clear). `task_type` is still recorded as metadata for classification and filtering, but it is not used for precise task deletion in the UI.

2. **Execution**:
    * The task runs in a separate process.
    * **Note**: Worker processes are isolated. They cannot share memory with the main process. All inputs/outputs must be picklable.

3. **Monitoring**:
    * `_monitor_task_completion` waits for the `Future` to complete.
    * `_progress_ticker` emits simulated progress updates (since real-time progress from a subprocess is complex).

4. **Completion**:
    * On success: The result is saved via `_save_analysis_result` to the `analysis_store`.
    * On failure: An error event is emitted.

## Client-Facing Task Operations (Cancel / Clear)

The backend exposes workspace-scoped endpoints for task administration:

* `POST /api/workspaces/{workspace_id}/tasks/cancel?task_id=<id>` cancels a single task.
* `POST /api/workspaces/{workspace_id}/tasks/clear?task_id=<id>` removes a single task record from the in-memory task manager.

These endpoints also accept `task_type` for bulk operations, but the frontend uses **task-id-only** cancellation/clearing to avoid accidentally affecting unrelated tasks.

## Adding a New Task

1. **Define the Task Function**:
    * Create a standalone function (e.g., in `core/worker.py` or a new module).
    * **Crucial**: The function must be importable by the worker process. Avoid closures or lambdas.

2. **Register the Task**:
    * Add the function to `TASK_REGISTRY` in `core/worker.py`.

    ```python
    # core/worker.py
    TASK_REGISTRY = {
        "topic_modeling": topic_modeling_task,
        "my_new_task": my_new_task_function,
    }
    ```

3. **Submit the Task**:
    * Use `tm.submit_task("my_new_task", args={...})` in your API endpoint.

## Concurrency & Threading

### ProcessPoolExecutor

We use `ProcessPoolExecutor` because:

* **GIL Avoidance**: Python's GIL prevents true parallelism for CPU-bound tasks in threads. Processes have their own GIL.
* **Isolation**: Crashes in a worker process (e.g., C-extension segfaults) are less likely to bring down the main server.

### Numba & TBB

You may see logs like:
`INFO: Numba: Using TBB threading layer (thread-safe, TBB-managed threads)`

This is **normal and desirable**.

* **Why?** Libraries like `BERTopic` use `hdbscan` and `umap-learn`, which rely on `Numba` for JIT compilation.
* **TBB (Threading Building Blocks)**: A C++ library for parallelism. Numba uses it to parallelize loops *inside* the worker process.
* **Safety**: Standard OpenMP threading can sometimes conflict with Python's multiprocessing (causing deadlocks). TBB is generally safer and more robust for this architecture.
* **Configuration**: `core/worker.py` explicitly configures Numba to use TBB if available, or falls back to safe serial execution (`workqueue`) to prevent crashes.
