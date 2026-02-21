"""Process-pool worker facade and task registry."""

from __future__ import annotations

import os
from concurrent.futures import Future, ProcessPoolExecutor
from typing import Any, Dict, Optional

from .worker_tasks_concordance import run_concordance_detach_task
from .worker_tasks_download import run_workspace_download_task
from .worker_tasks_import import run_ldaca_import_task
from .worker_tasks_quotation import run_quotation_detach_task
from .worker_tasks_token import run_token_frequencies_task
from .worker_tasks_topic import run_topic_modeling_task


def _configure_worker_environment() -> None:
    """Initialize worker process runtime environment."""
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def ldaca_import_task(
    file_path: str,
    workspace_name: str,
    user_id: str,
    file_info: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[callable] = None,
    workspace_id: Optional[str] = None,
) -> Dict[str, Any]:
    return run_ldaca_import_task(
        _configure_worker_environment,
        file_path,
        workspace_name,
        user_id,
        file_info,
    )


def workspace_download_task(
    user_id: str,
    workspace_id: str,
    workspace_name: str,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    return run_workspace_download_task(
        _configure_worker_environment,
        user_id,
        workspace_id,
        workspace_name,
    )


def concordance_detach_task(
    user_id: str,
    workspace_id: str,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
    new_node_name: str,
    artifact_dir: str,
    artifact_prefix: str,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    return run_concordance_detach_task(
        _configure_worker_environment,
        node_corpus,
        parent_node_id,
        document_column,
        search_word,
        num_left_tokens,
        num_right_tokens,
        regex,
        case_sensitive,
        new_node_name,
        artifact_dir,
        artifact_prefix,
        progress_callback,
    )


def quotation_detach_task(
    user_id: str,
    workspace_id: str,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    engine_config: Dict[str, Any],
    new_node_name: str,
    artifact_dir: str,
    artifact_prefix: str,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    return run_quotation_detach_task(
        _configure_worker_environment,
        node_corpus,
        parent_node_id,
        document_column,
        engine_config,
        new_node_name,
        artifact_dir,
        artifact_prefix,
        progress_callback,
    )


def topic_modeling_task(
    user_id: str,
    workspace_id: str,
    corpora: Dict[str, list[str]],
    node_infos: Dict[str, Dict[str, str]],
    artifact_dir: str,
    artifact_prefix: str,
    min_topic_size: int,
    use_ctfidf: bool,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    return run_topic_modeling_task(
        configure_worker_environment=_configure_worker_environment,
        user_id=user_id,
        workspace_id=workspace_id,
        corpora=corpora,
        node_infos=node_infos,
        artifact_dir=artifact_dir,
        artifact_prefix=artifact_prefix,
        min_topic_size=min_topic_size,
        use_ctfidf=use_ctfidf,
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
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
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
