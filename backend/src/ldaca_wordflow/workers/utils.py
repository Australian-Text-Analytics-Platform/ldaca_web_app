"""Worker process environment and execution utilities.

Used by picklable Analysis and User File Import entrypoints before heavy
computation imports occur inside a child process.
"""

from __future__ import annotations

import functools
import logging
import os
from typing import Any
from collections.abc import Callable

logger = logging.getLogger(__name__)


def _configure_worker_environment() -> None:
    """Initialize worker process runtime environment."""
    import importlib
    import importlib.util

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

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


def process_entrypoint(func: Callable) -> Callable:
    """Configure the child process before invoking one worker function."""

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        _configure_worker_environment()
        return func(*args, **kwargs)

    wrapper.__wrapped__ = func
    return wrapper
