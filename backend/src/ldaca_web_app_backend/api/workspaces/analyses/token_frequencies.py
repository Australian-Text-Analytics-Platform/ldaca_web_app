"""Token Frequency analysis endpoints extracted from workspaces monolith.

Paths preserved exactly as /workspaces/{workspace_id}/token-frequencies*.
"""

import math

import polars as pl
from docframe import DocDataFrame, DocLazyFrame
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.token_frequency import (
    TokenFrequencyRequest as AnalysisTokenFrequencyRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import TokenFrequencyRequest, TokenFrequencyResponse
from ..utils import ensure_task_synced

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


def _sanitize_stop_words(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw_items = value.split(",")
    elif isinstance(value, (list, tuple, set)):
        raw_items = list(value)
    else:
        return []

    sanitized: list[str] = []
    seen: set[str] = set()
    for item in raw_items:
        if item is None:
            continue
        token = str(item).strip()
        if not token:
            continue
        lowered = token.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        sanitized.append(token)
    return sanitized


def _prepare_doclazy_frame(node, column_name: str, user_id: str, workspace_id: str):
    """Convert node data to a DocLazyFrame with the requested document column.

    This avoids workspace cwd juggling and simply records the chosen column on
    the node for future reference.
    """

    data = getattr(node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")

    if isinstance(data, DocLazyFrame):
        processed = (
            data
            if data.document_column == column_name
            else data.with_document_column(column_name)
        )
    elif isinstance(data, DocDataFrame):
        processed = DocLazyFrame(data.dataframe.lazy(), document_column=column_name)  # type: ignore[misc]
    elif isinstance(data, pl.LazyFrame):
        processed = DocLazyFrame(data, document_column=column_name)  # type: ignore[misc]
    elif isinstance(data, pl.DataFrame):
        processed = DocLazyFrame(data.lazy(), document_column=column_name)  # type: ignore[misc]
    else:  # pragma: no cover - unsupported runtime type
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported node data type for text analysis: {type(data).__name__}",
        )

    try:
        node.document = column_name
        node.data = processed
        workspace_manager.persist(user_id, workspace_id)
    except Exception:
        pass

    return processed


def _safe_float(value, *, default: float | None = 0.0) -> float | None:
    try:
        number = float(value)
    except TypeError, ValueError:
        return default
    if math.isnan(number) or math.isinf(number):
        return default
    return number


def _normalize_limit_payload(payload: dict | None) -> dict:
    if not isinstance(payload, dict):
        limit = DEFAULT_TOKEN_LIMIT
        return {"token_limit": limit, "stop_words": []}

    merged = {**payload}
    candidate = merged.get("token_limit")

    limit = _coerce_limit_value(candidate)
    merged["token_limit"] = limit
    merged["stop_words"] = _sanitize_stop_words(merged.get("stop_words"))
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

    stop_words = _sanitize_stop_words(raw_stop_words)

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
    description="Calculate and compare token frequencies across one or two nodes using the docframe library",
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

    workspace = workspace_manager.get_workspace(user_id, workspace_id)
    if not workspace:
        raise HTTPException(
            status_code=404, detail=f"Workspace {workspace_id} not found"
        )

    validated_columns: dict[str, str] = {}
    node_display_names: dict[str, str] = {}

    for node_id in request.node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        node_data = node.data if hasattr(node, "data") else node
        node_name = node.name if hasattr(node, "name") and node.name else node_id
        node_display_names[node_id] = node_name

        is_doc_frame = isinstance(node_data, (DocDataFrame, DocLazyFrame))

        if hasattr(node_data, "columns"):
            available_columns = node_data.columns
        elif hasattr(node_data, "collect_schema"):
            available_columns = list(node_data.collect_schema().keys())
        elif hasattr(node_data, "schema"):
            available_columns = list(node_data.schema.keys())
        else:
            available_columns = []

        column_name = request.node_columns.get(node_id)
        if not column_name:
            if is_doc_frame and getattr(node_data, "document_column", None):
                column_name = node_data.document_column
            else:
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
        _prepare_doclazy_frame(node, column_name, user_id, workspace_id)
        validated_columns[node_id] = column_name

    # Stop words are UI-only preferences; persist them but do not apply to compute.
    requested_stop_words = _sanitize_stop_words(request.stop_words)

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
