"""Shared utility helpers for workspace API modules."""

from typing import Any, Optional, Tuple

from fastapi import HTTPException

from ...core.json_utils import json_sanitize  # type: ignore


def success(data=None, message: str = "ok", state: str = "successful", **extra):
    payload = {"state": state, "message": message, "data": data}
    if extra:
        payload.update(extra)
    return json_sanitize(payload)


def running(message: str = "running", metadata: Optional[dict] = None):
    return success(data=None, message=message, state="running", metadata=metadata or {})


def failed(message: str, error: Any = None, status_code: int = 400):
    detail = {"message": message}
    if error is not None:
        detail["error"] = str(error)
    raise HTTPException(status_code=status_code, detail=detail)


def _handle_operation_result(result: Any) -> Tuple[bool, str, Any]:  # exported
    try:
        if isinstance(result, tuple) and len(result) == 3:
            return result  # (success, message, object)
        return True, "ok", result
    except Exception as e:  # pragma: no cover
        return False, f"Unexpected result format: {e}", None


def configure_numba_threading():  # moved from base, idempotent
    import os

    try:
        import importlib

        numba_spec = importlib.util.find_spec("numba")
        if not numba_spec:
            return
        importlib.import_module("numba")  # type: ignore
        from numba import config  # type: ignore

        available_layers = getattr(config, "THREADING_LAYER_PRIORITY", [])
        tbb_available = False
        if isinstance(available_layers, (list, tuple)):
            tbb_available = "tbb" in available_layers
        elif isinstance(available_layers, str):
            tbb_available = "tbb" in available_layers
        if not tbb_available and importlib.util.find_spec("tbb"):
            tbb_available = True
        if tbb_available:
            os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "tbb workqueue omp")
            os.environ.setdefault("NUMBA_THREADING_LAYER", "tbb")
        else:
            os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")
            os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "workqueue omp tbb")
            os.environ.setdefault("NUMBA_NUM_THREADS", "1")
    except Exception:  # pragma: no cover
        os.environ.setdefault("NUMBA_THREADING_LAYER", "workqueue")
        os.environ.setdefault("NUMBA_THREADING_LAYER_PRIORITY", "workqueue omp tbb")
        os.environ.setdefault("NUMBA_NUM_THREADS", "1")


__all__ = [
    "success",
    "running",
    "failed",
    "_handle_operation_result",
    "configure_numba_threading",
]
