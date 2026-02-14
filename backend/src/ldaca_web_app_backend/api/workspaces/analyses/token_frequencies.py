"""Token Frequency analysis endpoints extracted from workspaces monolith.

Paths preserved exactly as /workspaces/{workspace_id}/token-frequencies*.
"""

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.token_frequency import (
    TokenFrequencyRequest as AnalysisTokenFrequencyRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.analysis_helpers import sanitize_stop_words
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import TokenFrequencyRequest, TokenFrequencyResponse
from ..utils import ensure_task_synced, get_workspace_or_404

# This router uses the same '/workspaces' prefix as the base router so paths are identical
# to their original definitions when included at top level.
router = APIRouter(prefix="/workspaces")

DEFAULT_TOKEN_LIMIT = 10
SERVER_LIMIT_MULTIPLIER = 5
MAX_SERVER_TOKEN_LIMIT = 5000
_STOP_WORDS_UNSET = object()


def _coerce_limit_value(value) -> int:
    try:
        candidate = int(value)  # type: ignore[arg-type]
    except TypeError, ValueError:
        return DEFAULT_TOKEN_LIMIT
    return candidate if candidate > 0 else DEFAULT_TOKEN_LIMIT


def _persist_text_column(node, column_name: str, user_id: str, workspace_id: str):
    """Persist the chosen text column on node metadata for future analyses."""
    try:
        if hasattr(node, "set_metadata"):
            node.set_metadata("text_column", column_name)
        else:
            metadata = getattr(node, "metadata", None)
            if not isinstance(metadata, dict):
                metadata = {}
            metadata["text_column"] = column_name
            setattr(node, "metadata", metadata)
        workspace_manager.persist(user_id, workspace_id)
    except Exception:
        pass


def _normalize_limit_payload(payload: dict | None) -> dict:
    if not isinstance(payload, dict):
        limit = DEFAULT_TOKEN_LIMIT
        return {
            "token_limit": limit,
            "stop_words": [],
        }

    merged = {**payload}
    candidate = merged.get("token_limit")

    limit = _coerce_limit_value(candidate)
    merged["token_limit"] = limit
    merged["stop_words"] = sanitize_stop_words(merged.get("stop_words"))
    return merged


def _prepare_result_blob(
    result_blob: dict,
    request_payload: dict | None,
    *,
    limit_override: int | None = None,
    stop_words_override=_STOP_WORDS_UNSET,
):
    normalized_request = _normalize_limit_payload(request_payload)
    # Build shallow copies so callers can mutate without affecting stored state
    normalized_result = {**result_blob}
    existing_metadata = (
        {**normalized_result.get("metadata", {})}
        if isinstance(normalized_result.get("metadata"), dict)
        else {}
    )
    existing_params = (
        {**normalized_result.get("analysis_params", {})}
        if isinstance(normalized_result.get("analysis_params"), dict)
        else {}
    )

    limit_candidates = [
        limit_override,
        normalized_result.get("token_limit"),
        existing_params.get("token_limit"),
        existing_metadata.get("token_limit"),
        normalized_request.get("token_limit"),
    ]

    limit_value = next(
        (
            _coerce_limit_value(candidate)
            for candidate in limit_candidates
            if candidate is not None
        ),
        DEFAULT_TOKEN_LIMIT,
    )

    if limit_override is not None:
        limit_value = _coerce_limit_value(limit_override)

    if stop_words_override is _STOP_WORDS_UNSET:
        stop_candidates = [
            normalized_result.get("stop_words"),
            existing_metadata.get("stop_words"),
            existing_params.get("stop_words"),
            normalized_request.get("stop_words"),
        ]
        raw_stop_words = next(
            (candidate for candidate in stop_candidates if candidate is not None),
            [],
        )
    else:
        raw_stop_words = stop_words_override

    stop_words = sanitize_stop_words(raw_stop_words)

    server_limit = min(
        max(limit_value * SERVER_LIMIT_MULTIPLIER, DEFAULT_TOKEN_LIMIT),
        MAX_SERVER_TOKEN_LIMIT,
    )

    existing_metadata["token_limit"] = limit_value
    existing_metadata["server_limit"] = server_limit
    existing_metadata["stop_words"] = stop_words

    existing_params["token_limit"] = limit_value
    existing_params["stop_words"] = stop_words

    normalized_request["token_limit"] = limit_value
    normalized_request["stop_words"] = stop_words

    normalized_result["token_limit"] = limit_value
    normalized_result["analysis_params"] = existing_params
    normalized_result["metadata"] = existing_metadata
    normalized_result["stop_words"] = stop_words

    if "state" not in normalized_result:
        normalized_result["state"] = "successful"

    return normalized_result, normalized_request, limit_value, stop_words


def _unwrap_task_manager_result(result_dict: dict) -> dict:
    """Handle the WorkerTaskManager result wrapper.

    For worker-backed tasks, analysis_store may contain a wrapper like:
      {"status": "successful", "message": "...", "data": <worker_result>}

    For historical/synchronous paths, analysis_store may contain the final
    response payload directly.
    """

    if not isinstance(result_dict, dict):
        return {}
    # If it's already the final response blob, keep it.
    if "state" in result_dict and "message" in result_dict:
        return result_dict
    # If it's wrapped (WorkerTaskManager convention), unwrap the inner payload.
    inner = result_dict.get("data")
    if isinstance(inner, dict):
        return inner
    return result_dict


@router.get("/{workspace_id}/token-frequencies/tasks/{task_id}/result")
async def token_frequencies_task_result(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return a normalized token frequency result for a task id."""
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)

    # Sync with worker if running using shared utility
    task = await ensure_task_synced(user_id, workspace_id, task_id, task_manager)
    if not task or not task.result:
        return None

    stored = task.result.to_json() if hasattr(task.result, "to_json") else task.result
    if not isinstance(stored, dict):
        return None

    stored = _unwrap_task_manager_result(stored)
    if not isinstance(stored, dict) or not stored:
        return None

    request_payload = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    result_blob, _normalized_request, _limit_value, _stop_words = _prepare_result_blob(
        stored,
        request_payload,
    )
    return result_blob


@router.post("/{workspace_id}/token-frequencies/tasks/{task_id}/result")
async def update_token_frequencies_task_result(
    workspace_id: str,
    task_id: str,
    updates: dict | None,
    current_user: dict = Depends(get_current_user),
):
    """Update stored token frequency preferences for a task id."""
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="No token frequency task found")

    request_payload = task.request.model_dump()
    result_payload_raw = task.result.to_json() if task.result else {}
    result_payload = _unwrap_task_manager_result(result_payload_raw)
    if not isinstance(result_payload, dict):
        result_payload = {}

    limit_override = None
    stop_words_override = _STOP_WORDS_UNSET
    if isinstance(updates, dict):
        if "token_limit" in updates:
            limit_override = updates.get("token_limit")
        if "stop_words" in updates:
            stop_words_override = updates.get("stop_words")
    else:
        updates = {}

    result_blob, normalized_request, _limit_value, _stop_words = _prepare_result_blob(
        result_payload,
        request_payload,
        limit_override=limit_override,
        stop_words_override=stop_words_override,
    )

    request_payload.update(normalized_request)

    try:
        task.request = AnalysisTokenFrequencyRequest(**request_payload)
        task.complete(GenericAnalysisResult(result_blob))
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
    """Start token frequency analysis in a background worker process.

    Mirrors the concordance/topic-modeling convention:
    - POST submits a process-backed task and returns a task_id (state=running)
    - request is persisted immediately into analysis_store with an empty result
    - GET current-result serves the persisted result when the worker completes
    """

    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    # Check if already running
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
        # Non-fatal: proceed to submit
        pass

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )
    if len(request.node_ids) > 2:
        raise HTTPException(
            status_code=400, detail="Maximum of 2 nodes can be compared"
        )
    if not request.node_columns:
        request.node_columns = {}

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

    validated_columns: dict[str, str] = {}
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
        available_columns = list(node_data.collect_schema().names())

        column_name = request.node_columns.get(node_id)
        if not column_name:
            metadata = getattr(node, "metadata", {}) or {}
            if isinstance(metadata, dict):
                column_name = metadata.get("text_column")
        if not column_name:
            for col in ["document", "text", "content", "body", "message"]:
                if col in available_columns:
                    column_name = col
                    break
        if not column_name:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Could not determine text column for node {node_id}. Available columns: {available_columns}"
                ),
            )
        if column_name not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not found in node {node_id}. Available columns: {available_columns}",
            )

        # Persist chosen document column for future analyses (lightweight)
        _persist_text_column(node, column_name, user_id, workspace_id)
        validated_columns[node_id] = column_name

    # Stop words are UI-only preferences; persist them but do not apply to compute.
    requested_stop_words = sanitize_stop_words(request.stop_words)

    task_info = await tm.submit_task(
        user_id=user_id,
        workspace_id=workspace_id,
        task_type="token_frequencies",
        task_args={
            "node_ids": request.node_ids,
            "node_columns": validated_columns,
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
    task_manager.set_current_task("token-frequencies", task_info.id)

    return {
        "state": "running",
        "message": "Token frequency analysis started",
        "data": None,
        "token_limit": effective_limit,
        "stop_words": requested_stop_words,
        "metadata": {"task_id": task_info.id},
    }
