"""Shared utility helpers for workspace API modules."""

import re
from pathlib import Path
from typing import Any, Optional, Tuple

import polars as pl
from fastapi import HTTPException

from docframe import DocLazyFrame

from ...core.json_utils import json_sanitize  # type: ignore
from ...core.workspace import workspace_manager


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


def stage_dataframe_as_lazy(
    data: Any,
    workspace_dir: Path,
    node_name: str,
    document_column: Optional[str] = None,
):
    """Persist a dataframe to parquet under the workspace and reload as LazyFrame.

    This mirrors the lazy serialize/reload pattern used by the base add-node endpoint
    so that detached/derived nodes remain portable and lazy by default.
    """

    data_dir = workspace_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    def _safe_stem(name: str) -> str:
        stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._") or "data"
        return stem

    base_stem = _safe_stem(node_name)
    parquet_path = data_dir / f"{base_stem}.parquet"
    suffix = 1
    while parquet_path.exists():
        parquet_path = data_dir / f"{base_stem}_{suffix}.parquet"
        suffix += 1

    # Normalize to an eager Polars DataFrame before persisting
    df: pl.DataFrame
    try:
        if hasattr(data, "lazyframe"):
            data = data.lazyframe  # type: ignore[attr-defined]
        if isinstance(data, pl.LazyFrame):
            df = data.collect()
        elif hasattr(data, "dataframe"):
            df = pl.DataFrame(getattr(data, "dataframe"))  # type: ignore[arg-type]
        elif hasattr(data, "collect") and not isinstance(data, pl.DataFrame):
            collected = data.collect()  # type: ignore[operator]
            df = (
                collected
                if isinstance(collected, pl.DataFrame)
                else pl.DataFrame(collected)
            )
        else:
            df = data if isinstance(data, pl.DataFrame) else pl.DataFrame(data)
    except Exception as exc:  # pragma: no cover - defensive coercion
        raise HTTPException(
            status_code=400, detail=f"Failed to coerce data to DataFrame: {exc}"
        )

    try:
        df.write_parquet(parquet_path)
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to persist parquet for workspace: {exc}"
        )

    try:
        lazy_data: Any = pl.scan_parquet(parquet_path)
        if document_column:
            try:
                lazy_data = DocLazyFrame(lazy_data, document_column=document_column)
            except Exception:
                # If wrapping fails due to schema resolution, fall back for now
                pass
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to reload parquet as LazyFrame: {exc}"
        )

    if document_column:
        try:
            if not isinstance(lazy_data, DocLazyFrame):
                lazy_data = DocLazyFrame(lazy_data, document_column=document_column)
        except Exception:
            # If wrapping fails due to schema issues, fall back to plain LazyFrame
            pass

    return lazy_data


def get_node_or_404(
    user_id: str, workspace_id: str, node_id: str, detail: Optional[str] = None
):
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail=detail or "Node not found")
    return node


def get_node_with_data_or_400(
    user_id: str,
    workspace_id: str,
    node_id: str,
    not_found_detail: Optional[str] = None,
):
    node = get_node_or_404(user_id, workspace_id, node_id, detail=not_found_detail)
    data = getattr(node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")
    return node, data


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
    "get_node_or_404",
    "get_node_with_data_or_400",
    "stage_dataframe_as_lazy",
]
