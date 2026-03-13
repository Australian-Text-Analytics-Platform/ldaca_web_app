"""Process-pool worker facade and task registry."""

from __future__ import annotations

import logging
import os
import time
from concurrent.futures import Future, ProcessPoolExecutor
from typing import Any, Callable, Dict, Optional

from .worker_tasks_concordance import run_concordance_detach_task
from .worker_tasks_download import run_workspace_download_task
from .worker_tasks_import import run_ldaca_import_task
from .worker_tasks_quotation import run_quotation_detach_task
from .worker_tasks_token import run_token_frequencies_task
from .worker_tasks_topic import run_topic_modeling_task

logger = logging.getLogger(__name__)


def _build_progress_callback(
    progress_queue: Optional[Any],
    progress_callback: Optional[Callable[[float, str], None]],
) -> Optional[Callable[[float, str], None]]:
    if progress_queue is None and progress_callback is None:
        return None

    def _cb(progress: float, message: str) -> None:
        payload = {
            "progress": float(progress),
            "message": str(message),
            "timestamp": time.time(),
        }

        if progress_queue is not None:
            try:
                progress_queue.put_nowait(payload)
            except Exception as exc:
                logger.debug(
                    "progress_queue.put_nowait failed, retrying with put: %s", exc
                )
                try:
                    progress_queue.put(payload)
                except Exception as put_exc:
                    logger.debug(
                        "progress_queue.put failed; dropping progress payload: %s",
                        put_exc,
                    )

        if progress_callback is not None:
            try:
                progress_callback(progress, message)
            except Exception as exc:
                logger.debug("progress_callback invocation failed: %s", exc)

    return _cb


def _configure_worker_environment() -> None:
    """Initialize worker process runtime environment."""
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    try:
        import importlib

        tbb_available = False
        try:
            if importlib.util.find_spec("tbb"):
                importlib.import_module("tbb")
                tbb_available = True
            elif importlib.util.find_spec("tbb4py"):
                importlib.import_module("tbb4py")
                tbb_available = True
        except Exception:
            tbb_available = False

        if tbb_available:
            os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "tbb workqueue omp")
            os.environ.setdefault("NUMBA_THREADING_LAYER", "tbb")
        else:
            os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")
            os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "workqueue omp tbb")
            os.environ.setdefault("NUMBA_NUM_THREADS", "1")
    except Exception:
        os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")
        os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "workqueue omp tbb")
        os.environ.setdefault("NUMBA_NUM_THREADS", "1")


def ldaca_import_task(
    user_id: str,
    workspace_id: str,
    url: str,
    filename: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    progress_queue: Optional[Any] = None,
) -> Dict[str, Any]:
    cb = _build_progress_callback(progress_queue, progress_callback)
    return run_ldaca_import_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        url,
        filename,
        cb,
    )


def workspace_download_task(
    user_id: str,
    workspace_id: str,
    target_workspace_id: Optional[str] = None,
    target_workspace_dir: Optional[str] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    progress_queue: Optional[Any] = None,
) -> Dict[str, Any]:
    cb = _build_progress_callback(progress_queue, progress_callback)
    return run_workspace_download_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        target_workspace_dir,
        cb,
    )


def concordance_detach_task(
    user_id: str,
    workspace_id: str,
    workspace_dir: str,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
    new_node_name: str,
    include_document_column: bool = False,
    extra_columns_data: Optional[Dict[str, list]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    progress_queue: Optional[Any] = None,
) -> Dict[str, Any]:
    cb = _build_progress_callback(progress_queue, progress_callback)
    return run_concordance_detach_task(
        _configure_worker_environment,
        workspace_dir,
        node_corpus,
        parent_node_id,
        document_column,
        search_word,
        num_left_tokens,
        num_right_tokens,
        regex,
        case_sensitive,
        new_node_name,
        include_document_column,
        extra_columns_data,
        cb,
    )


def quotation_detach_task(
    user_id: str,
    workspace_id: str,
    workspace_dir: str,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    engine_config: Dict[str, Any],
    new_node_name: str,
    include_document_column: bool = False,
    extra_columns_data: Optional[Dict[str, list]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    progress_queue: Optional[Any] = None,
) -> Dict[str, Any]:
    cb = _build_progress_callback(progress_queue, progress_callback)
    return run_quotation_detach_task(
        _configure_worker_environment,
        workspace_dir,
        node_corpus,
        parent_node_id,
        document_column,
        engine_config,
        new_node_name,
        include_document_column,
        extra_columns_data,
        cb,
    )


def topic_modeling_task(
    user_id: str,
    workspace_id: str,
    corpora: Dict[str, list[str]],
    node_infos: Dict[str, Dict[str, str]],
    artifact_dir: str,
    artifact_prefix: str,
    min_topic_size: int,
    random_seed: int = 42,
    representative_words_count: int = 5,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    progress_queue: Optional[Any] = None,
) -> Dict[str, Any]:
    cb = _build_progress_callback(progress_queue, progress_callback)
    return run_topic_modeling_task(
        configure_worker_environment=_configure_worker_environment,
        user_id=user_id,
        workspace_id=workspace_id,
        corpora=corpora,
        node_infos=node_infos,
        artifact_dir=artifact_dir,
        artifact_prefix=artifact_prefix,
        min_topic_size=min_topic_size,
        random_seed=random_seed,
        representative_words_count=representative_words_count,
        progress_callback=cb,
    )


def token_frequencies_task(
    user_id: str,
    workspace_id: str,
    node_corpora: Dict[str, list[str]],
    node_display_names: Dict[str, str],
    artifact_dir: str,
    artifact_prefix: str,
    token_limit: int,
    stop_words: Optional[list[str]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
    progress_queue: Optional[Any] = None,
) -> Dict[str, Any]:
    cb = _build_progress_callback(progress_queue, progress_callback)
    return run_token_frequencies_task(
        configure_worker_environment=_configure_worker_environment,
        user_id=user_id,
        workspace_id=workspace_id,
        node_corpora=node_corpora,
        node_display_names=node_display_names,
        artifact_dir=artifact_dir,
        artifact_prefix=artifact_prefix,
        token_limit=token_limit,
        stop_words=stop_words,
        progress_callback=cb,
    )


TASK_REGISTRY: Dict[str, Any] = {
    "ldaca_import": ldaca_import_task,
    "workspace_download": workspace_download_task,
    "concordance_detach": concordance_detach_task,
    "quotation_detach": quotation_detach_task,
    "topic_modeling": topic_modeling_task,
    "token_frequencies": token_frequencies_task,
}

_worker_pool: Optional["WorkerTaskManager"] = None


def get_worker_pool(max_workers: int = 2) -> "WorkerTaskManager":
    global _worker_pool
    if _worker_pool is None:
        _worker_pool = WorkerTaskManager(max_workers=max_workers)
    return _worker_pool


class WorkerTaskManager:
    """Simple process-pool task manager for CPU-heavy operations."""

    def __init__(self, max_workers: int = 2):
        self.max_workers = max_workers
        self.executor: Optional[ProcessPoolExecutor] = None
        self.is_running = False

    def start(self) -> None:
        if self.executor is None:
            self.executor = ProcessPoolExecutor(max_workers=self.max_workers)
        self.is_running = True

    def submit_task(self, task_func: Any, **kwargs: Any) -> Future:
        if self.executor is None:
            self.start()

        assert self.executor is not None
        return self.executor.submit(task_func, **kwargs)

    def shutdown(self, wait: bool = True, timeout: Optional[float] = None) -> None:
        if self.executor is None:
            self.is_running = False
            return
        self.executor.shutdown(wait=wait)
        self.executor = None
        self.is_running = False
        self.is_running = False
