"""Token Frequency analysis endpoints.

Artifact-first implementation:
- API gathers immutable payload (node corpora) in main process.
- Worker computes and writes Parquet artifacts.
- Result endpoint reconstructs response by lazy-scanning artifacts.
"""

from __future__ import annotations

import math
from pathlib import Path
from uuid import uuid4

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.token_frequency import (
    TokenFrequencyRequest as AnalysisTokenFrequencyRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....core.analysis_helpers import sanitize_stop_words
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import TokenFrequencyRequest, TokenFrequencyResponse
from ..utils import ensure_task_synced, get_workspace_or_404
from .text_column_prefs import resolve_text_columns_for_nodes

router = APIRouter(prefix="/workspaces")

DEFAULT_TOKEN_LIMIT = 10
SERVER_LIMIT_MULTIPLIER = 5
MAX_SERVER_TOKEN_LIMIT = 5000


def _unwrap_task_manager_result(raw_result):
    """Normalize stored TaskManager result wrappers into plain dictionaries."""
    if raw_result is None:
        return {}
    if isinstance(raw_result, dict):
        nested = raw_result.get("result")
        if isinstance(nested, dict):
            return nested
        return raw_result
    if isinstance(raw_result, str):
        return {"state": "successful", "message": raw_result}
    return {"state": "successful"}


def _coerce_limit_value(value) -> int:
    """Coerce token-limit input to a safe positive integer."""
    try:
        candidate = int(value)  # type: ignore[arg-type]
    except TypeError, ValueError:
        return DEFAULT_TOKEN_LIMIT
    return candidate if candidate > 0 else DEFAULT_TOKEN_LIMIT


def _prepare_token_artifact_target(user_id: str, workspace_id: str) -> tuple[Path, str]:
    workspace_artifacts_dir = workspace_manager.ensure_workspace_artifacts_dir(
        user_id, workspace_id
    )
    if workspace_artifacts_dir is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    artifact_prefix = f"token_frequencies_{uuid4()}"
    return workspace_artifacts_dir, artifact_prefix


def _task_result_payload(task: AnalysisTask) -> dict:
    if task.result is None:
        return {}
    payload = task.result.to_json()
    if not isinstance(payload, dict):
        return {}
    return payload


def _token_artifacts_from_task(task: AnalysisTask) -> dict:
    payload = _task_result_payload(task)
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, dict):
        raise HTTPException(
            status_code=404,
            detail="Token-frequency artifacts are not available for this task",
        )
    node_artifacts = artifacts.get("nodes")
    if not isinstance(node_artifacts, list):
        raise HTTPException(
            status_code=500,
            detail="Token-frequency artifact manifest is invalid",
        )
    return payload


def _server_limit(token_limit: int) -> int:
    return min(
        max(token_limit * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
        MAX_SERVER_TOKEN_LIMIT,
    )


def _safe_float(value, default: float | None = 0.0):
    if value is None:
        return default
    try:
        numeric = float(value)
    except TypeError, ValueError:
        return default
    if not math.isfinite(numeric):
        return default
    return numeric


def _rebuild_token_result(task: AnalysisTask) -> dict:
    payload = _token_artifacts_from_task(task)
    artifacts = payload["artifacts"]

    request_payload = task.request.model_dump()
    token_limit = _coerce_limit_value(request_payload.get("token_limit"))
    stop_words = sanitize_stop_words(request_payload.get("stop_words"))
    stop_word_set = set(stop_words)

    node_results: dict[str, dict] = {}
    for node_entry in artifacts.get("nodes", []):
        if not isinstance(node_entry, dict):
            continue
        node_id = str(node_entry.get("node_id") or "")
        if not node_id:
            continue
        token_path = Path(str(node_entry.get("token_parquet_path") or ""))
        if not token_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Token artifact missing for node {node_id}",
            )

        token_lf = pl.scan_parquet(token_path)
        if stop_word_set:
            token_lf = token_lf.filter(~pl.col("token").is_in(list(stop_word_set)))

        token_df = token_lf.collect()
        rows = token_df.to_dicts()
        total_tokens = len(rows)
        display_name = str(node_entry.get("node_name") or node_id)
        node_results[node_id] = {
            "data": [
                {
                    "token": str(row.get("token") or ""),
                    "frequency": int(row.get("frequency") or 0),
                }
                for row in rows
            ],
            "columns": ["token", "frequency"],
            "metadata": {
                "applied_server_limit": None,
                "total_tokens_before_limit": total_tokens,
                "total_tokens_returned": total_tokens,
                "truncated": False,
                "token_limit": token_limit,
                "node_id": node_id,
                "display_name": display_name,
                "node_name": display_name,
            },
        }

    statistics_payload = None
    stats_path_str = artifacts.get("statistics_parquet_path")
    if isinstance(stats_path_str, str) and stats_path_str:
        stats_path = Path(stats_path_str)
        if not stats_path.exists():
            raise HTTPException(
                status_code=404, detail="Token statistics artifact is missing"
            )
        stats_df = pl.scan_parquet(stats_path).collect()
        statistics_payload = [
            {
                "token": str(row.get("token") or ""),
                "freq_corpus_0": int(row.get("freq_corpus_0") or 0),
                "freq_corpus_1": int(row.get("freq_corpus_1") or 0),
                "expected_0": _safe_float(row.get("expected_0"), 0.0),
                "expected_1": _safe_float(row.get("expected_1"), 0.0),
                "corpus_0_total": int(row.get("corpus_0_total") or 0),
                "corpus_1_total": int(row.get("corpus_1_total") or 0),
                "percent_corpus_0": _safe_float(row.get("percent_corpus_0"), 0.0),
                "percent_corpus_1": _safe_float(row.get("percent_corpus_1"), 0.0),
                "percent_diff": _safe_float(row.get("percent_diff"), 0.0),
                "log_likelihood_llv": _safe_float(row.get("log_likelihood_llv"), 0.0),
                "bayes_factor_bic": _safe_float(row.get("bayes_factor_bic"), 0.0),
                "effect_size_ell": _safe_float(row.get("effect_size_ell"), 0.0),
                "relative_risk": (
                    _safe_float(row.get("relative_risk"), None)
                    if row.get("relative_risk") is not None
                    else None
                ),
                "log_ratio": (
                    _safe_float(row.get("log_ratio"), None)
                    if row.get("log_ratio") is not None
                    else None
                ),
                "odds_ratio": (
                    _safe_float(row.get("odds_ratio"), None)
                    if row.get("odds_ratio") is not None
                    else None
                ),
                "significance": str(row.get("significance") or ""),
            }
            for row in stats_df.to_dicts()
        ]

    server_limit = _server_limit(token_limit)
    analysis_params = {
        "node_ids": list(request_payload.get("node_ids") or []),
        "node_columns": dict(request_payload.get("node_columns") or {}),
        "token_limit": token_limit,
        "server_limit": server_limit,
        "stop_words": stop_words,
    }
    metadata = {
        "token_limit": token_limit,
        "server_limit": server_limit,
        "stop_words": stop_words,
        "node_display_names": {
            str(entry.get("node_id")): str(
                entry.get("node_name") or entry.get("node_id")
            )
            for entry in artifacts.get("nodes", [])
            if isinstance(entry, dict) and entry.get("node_id")
        },
    }

    return {
        "state": payload.get("state") or "successful",
        "message": payload.get("message")
        or f"Successfully calculated token frequencies for {len(node_results)} node(s)",
        "data": node_results,
        "statistics": statistics_payload,
        "token_limit": token_limit,
        "analysis_params": analysis_params,
        "metadata": metadata,
        "stop_words": stop_words,
    }


@router.get("/{workspace_id}/token-frequencies/tasks/{task_id}/result")
async def token_frequencies_task_result(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return normalized token-frequency result payload for one task."""
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)

    task = await ensure_task_synced(user_id, workspace_id, task_id, task_manager)
    if not task or not task.result:
        return None
    if task.status == AnalysisStatus.RUNNING:
        return {
            "state": "running",
            "message": "Token frequency analysis is still running",
            "data": None,
            "metadata": {"task_id": task_id},
        }
    return _rebuild_token_result(task)


@router.post("/{workspace_id}/token-frequencies/tasks/{task_id}/result")
async def update_token_frequencies_task_result(
    workspace_id: str,
    task_id: str,
    updates: dict | None,
    current_user: dict = Depends(get_current_user),
):
    """Persist token-frequency preference overrides on an existing task."""
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="No token frequency task found")

    request_payload = task.request.model_dump()

    if isinstance(updates, dict):
        if "token_limit" in updates:
            request_payload["token_limit"] = _coerce_limit_value(
                updates.get("token_limit")
            )
        if "stop_words" in updates:
            request_payload["stop_words"] = sanitize_stop_words(
                updates.get("stop_words")
            )

    try:
        task.request = AnalysisTokenFrequencyRequest(**request_payload)
        task_manager.save_task(task)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist token frequency preferences: {exc}",
        )

    return {"state": "successful", "message": "saved"}


@router.post(
    "/{workspace_id}/token-frequencies",
    response_model=TokenFrequencyResponse,
    summary="Calculate token frequencies for selected nodes",
    description="Calculate and compare token frequencies across one or two nodes using polars-text",
)
async def calculate_token_frequencies(
    workspace_id: str,
    request: TokenFrequencyRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit token-frequency analysis as a worker-backed artifact-first task."""

    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    try:
        if await tm.any_running(
            task_type="token_frequencies", user_id=user_id, workspace_id=workspace_id
        ):
            latest = await tm.latest_by_type(
                "token_frequencies", user_id=user_id, workspace_id=workspace_id
            )
            return {
                "state": "running",
                "message": "Token frequency analysis already running",
                "data": None,
                "metadata": {"task_id": latest.id if latest else None},
            }
    except Exception:
        pass

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )
    if len(request.node_ids) > 2:
        raise HTTPException(
            status_code=400, detail="Maximum of 2 nodes can be compared"
        )

    requested_token_limit = getattr(request, "token_limit", None)
    effective_limit = (
        requested_token_limit
        if requested_token_limit is not None and requested_token_limit > 0
        else DEFAULT_TOKEN_LIMIT
    )
    if requested_token_limit is not None and requested_token_limit <= 0:
        raise HTTPException(
            status_code=400, detail="token_limit must be a positive integer"
        )

    get_workspace_or_404(
        user_id, workspace_id, detail=f"Workspace {workspace_id} not found"
    )

    validated_columns = resolve_text_columns_for_nodes(
        user_id=user_id,
        workspace_id=workspace_id,
        node_ids=request.node_ids,
        requested_node_columns=request.node_columns or {},
        persist_preference=True,
    )

    node_corpora: dict[str, list[str]] = {}
    node_display_names: dict[str, str] = {}
    for node_id in request.node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        node_data = getattr(node, "data", None)
        if not isinstance(node_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} data must be a LazyFrame",
            )

        column_name = validated_columns.get(node_id)
        available_columns = list(node_data.collect_schema().names())
        if not column_name or column_name not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Column '{column_name}' not found in node {node_id}. "
                    f"Available columns: {available_columns}"
                ),
            )

        docs_df = node_data.select(pl.col(column_name).alias("__doc_col__")).collect()
        node_corpora[node_id] = [
            str(v) if v is not None else "" for v in docs_df["__doc_col__"].to_list()
        ]
        node_display_names[node_id] = str(getattr(node, "name", None) or node_id)

    requested_stop_words = sanitize_stop_words(request.stop_words)
    artifact_dir, artifact_prefix = _prepare_token_artifact_target(
        user_id, workspace_id
    )

    task_info = await tm.submit_task(
        user_id=user_id,
        workspace_id=workspace_id,
        task_type="token_frequencies",
        task_args={
            "node_corpora": node_corpora,
            "node_display_names": node_display_names,
            "artifact_dir": str(artifact_dir),
            "artifact_prefix": artifact_prefix,
            "token_limit": effective_limit,
            "stop_words": requested_stop_words,
        },
    )

    analysis_request = AnalysisTokenFrequencyRequest(
        node_ids=request.node_ids,
        node_columns=validated_columns,
        token_limit=effective_limit,
        stop_words=requested_stop_words,
    )

    task_manager = get_task_manager(user_id, workspace_id)
    task_manager.save_task(
        AnalysisTask(
            task_id=task_info.id,
            user_id=user_id,
            workspace_id=workspace_id,
            request=analysis_request,
            status=AnalysisStatus.PENDING,
        )
    )
    task_manager.set_current_task("token_frequencies", task_info.id)

    return {
        "state": "running",
        "message": "Token frequency analysis started",
        "data": None,
        "token_limit": effective_limit,
        "stop_words": requested_stop_words,
        "metadata": {"task_id": task_info.id},
    }
