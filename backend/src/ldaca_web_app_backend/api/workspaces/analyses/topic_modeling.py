"""Topic Modeling analysis endpoints (background-task based)."""

from __future__ import annotations

import asyncio

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.topic_modeling import (
    TopicModelingRequest as AnalysisTopicModelingRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import (
    TopicModelingDetachOptionsResponse,
    TopicModelingDetachRequest,
    TopicModelingDetachResponse,
    TopicModelingRequest,
    TopicModelingResponse,
)
from ..utils import ensure_task_synced, get_workspace_or_404
from .text_column_prefs import resolve_text_columns_for_nodes

router = APIRouter(prefix="/workspaces", tags=["topic-modeling"])

_TOPIC_SUBMISSION_LOCKS: dict[tuple[str, str], asyncio.Lock] = {}


def _topic_submission_lock(user_id: str, workspace_id: str) -> asyncio.Lock:
    key = (user_id, workspace_id)
    lock = _TOPIC_SUBMISSION_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _TOPIC_SUBMISSION_LOCKS[key] = lock
    return lock


@router.delete("/{workspace_id}/topic-modeling")
async def clear_topic_modeling_results(
    workspace_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Clear stored topic-modeling task state for a workspace.

    Used by:
    - Frontend clear action: `DELETE /workspaces/{id}/topic-modeling`

    Why:
    - Removes stale result/task pointers before reruns and keeps UI state
        aligned with backend task registries.
    """
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    task_manager = get_task_manager(user_id, workspace_id)
    current_id = task_manager.get_current_task_ids("topic_modeling")
    if current_id:
        task_manager.clear_task(current_id[0])

    worker_tm = workspace_manager.get_task_manager(user_id, workspace_id)
    if current_id:
        await worker_tm.clear_task(current_id[0])

    return {
        "state": "successful",
        "message": "Topic modeling analysis results have been cleared.",
    }


@router.post("/{workspace_id}/topic-modeling", response_model=TopicModelingResponse)
async def run_topic_modeling(
    workspace_id: str,
    request: TopicModelingRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit topic-modeling analysis as a worker-backed background task.

    Used by:
    - Frontend run route: `POST /workspaces/{id}/topic-modeling`

    Why:
    - Offloads heavy modeling work to worker processes and returns `task_id`
        for progress/result polling.
    """
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )

    node_columns = resolve_text_columns_for_nodes(
        user_id=user_id,
        workspace_id=workspace_id,
        node_ids=request.node_ids,
        requested_node_columns=request.node_columns or {},
        persist_preference=True,
    )

    corpora: list[list[str]] = []
    node_infos: list[dict[str, object]] = []
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

        column_name = node_columns.get(node_id)
        if not column_name:
            raise HTTPException(
                status_code=400,
                detail=f"Could not determine text column for node {node_id}",
            )

        available_columns = list(node_data.collect_schema().names())
        if column_name not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Column '{column_name}' not in node {node_id}. "
                    f"Available: {available_columns}"
                ),
            )

        sel_df = node_data.select(pl.col(column_name).alias("__doc_col__")).collect()
        docs = [
            str(v) if v is not None else "" for v in sel_df["__doc_col__"].to_list()
        ]
        corpora.append(docs)

        node_infos.append({
            "node_id": node_id,
            "node_name": getattr(node, "name", None) or node_id,
            "text_column": column_name,
            "original_columns": available_columns,
        })
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    submission_lock = _topic_submission_lock(user_id, workspace_id)
    async with submission_lock:
        # Match token-frequencies behavior: short-circuit when topic modeling is
        # already running for this workspace/user, with lock to avoid duplicate
        # concurrent submissions.
        try:
            if await tm.any_running(
                task_type="topic_modeling", user_id=user_id, workspace_id=workspace_id
            ):
                latest = await tm.latest_by_type(
                    "topic_modeling", user_id=user_id, workspace_id=workspace_id
                )
                return TopicModelingResponse(
                    state="running",
                    message="Topic Modeling analysis already running",
                    data=None,
                    metadata={"task_id": latest.id if latest else None},
                )
        except Exception:
            # Non-fatal: proceed to submit a new task.
            pass

        worker_task = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="topic_modeling",
            task_args={
                "corpora": corpora,
                "node_infos": node_infos,
                "min_topic_size": request.min_topic_size,
                "use_ctfidf": request.use_ctfidf,
            },
            task_name="Topic Modeling",
        )

    analysis_tm = get_task_manager(user_id, workspace_id)
    analysis_request = AnalysisTopicModelingRequest(
        node_ids=request.node_ids,
        node_columns=node_columns,
        min_topic_size=request.min_topic_size,
        use_ctfidf=request.use_ctfidf,
    )
    analysis_tm.save_task(
        AnalysisTask(
            task_id=worker_task.id,
            user_id=user_id,
            workspace_id=workspace_id,
            request=analysis_request,
            status=AnalysisStatus.RUNNING,
        )
    )
    analysis_tm.set_current_task("topic_modeling", worker_task.id)

    return TopicModelingResponse(
        state="running",
        message="Topic Modeling analysis started",
        data=None,
        metadata={"task_id": worker_task.id},
    )


@router.get(
    "/{workspace_id}/topic-modeling/tasks/{task_id}/result",
    response_model=TopicModelingResponse,
)
async def topic_modeling_task_result(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return current status or final payload for a topic-modeling task.

    Used by:
    - Frontend polling route:
        `GET /workspaces/{id}/topic-modeling/tasks/{task_id}/result`

    Why:
    - Normalizes task lifecycle states into one response contract for UI polling.
    """
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    task = await ensure_task_synced(
        user_id, workspace_id, task_id, get_task_manager(user_id, workspace_id)
    )

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status == AnalysisStatus.RUNNING:
        return TopicModelingResponse(
            state="running",
            message="Topic Modeling analysis is running",
            data=None,
            metadata={"task_id": task_id},
        )

    if task.status == AnalysisStatus.FAILED:
        return TopicModelingResponse(
            state="failed",
            message=(task.error or "Topic Modeling analysis failed"),
            data=None,
            metadata={"task_id": task_id},
        )

    if task.status == AnalysisStatus.COMPLETED and task.result:
        payload = task.result.to_json()
        if not isinstance(payload, dict):
            payload = {}
        return TopicModelingResponse(
            state="successful",
            message="Topic Modeling analysis complete",
            data=payload,
            metadata={"task_id": task_id},
        )

    return TopicModelingResponse(
        state="failed",
        message="Topic Modeling analysis failed",
        data=None,
        metadata={"task_id": task_id},
    )


def _resolve_topic_column_name(base_name: str, existing_columns: set[str]) -> str:
    """Return a unique output column name for detached topic labels.

    Used by:
    - `detach_topic_modeling`

    Why:
    - Prevents overwriting source columns when attaching generated topic labels.
    """
    candidate = base_name.strip() or "topic"
    if candidate not in existing_columns:
        return candidate
    idx = 1
    while f"{candidate}_{idx}" in existing_columns:
        idx += 1
    return f"{candidate}_{idx}"


@router.get(
    "/{workspace_id}/topic-modeling/tasks/{task_id}/detach-options",
    response_model=TopicModelingDetachOptionsResponse,
)
async def topic_modeling_detach_options(
    workspace_id: str,
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List detachable node/column options for a completed topic task.

    Used by:
    - Frontend detach-options route:
        `GET /workspaces/{id}/topic-modeling/tasks/{task_id}/detach-options`

    Why:
    - Exposes cached snapshot metadata so users can choose output columns safely.
    """
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    analysis_tm = get_task_manager(user_id, workspace_id)
    task = analysis_tm.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    worker_tm = workspace_manager.get_task_manager(user_id, workspace_id)
    cache_entries = worker_tm.list_topic_lazyframe_cache(task_id)
    if not cache_entries:
        raise HTTPException(
            status_code=404,
            detail="No cached topic snapshot found for this task. Please rerun topic modeling.",
        )
    nodes = []
    for node_id, payload in cache_entries.items():
        original_columns = list(payload.get("original_columns") or [])
        disabled_columns = ["topic"] if "topic" in original_columns else []
        nodes.append({
            "node_id": node_id,
            "node_name": payload.get("node_name") or node_id,
            "text_column": payload.get("text_column"),
            "available_columns": original_columns,
            "disabled_columns": disabled_columns,
        })

    return TopicModelingDetachOptionsResponse(
        state="successful",
        message="Topic detach options loaded",
        data={"nodes": nodes},
        metadata={"task_id": task_id},
    )


@router.post(
    "/{workspace_id}/topic-modeling/tasks/{task_id}/detach",
    response_model=TopicModelingDetachResponse,
)
async def detach_topic_modeling(
    workspace_id: str,
    task_id: str,
    request: TopicModelingDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create detached nodes from cached topic-modeling outputs.

    Used by:
    - Frontend detach route:
        `POST /workspaces/{id}/topic-modeling/tasks/{task_id}/detach`

    Why:
    - Materializes user-selected columns and topic labels as reusable workspace
        nodes without rerunning the model.
    """
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    analysis_tm = get_task_manager(user_id, workspace_id)
    task = analysis_tm.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    worker_tm = workspace_manager.get_task_manager(user_id, workspace_id)
    cache_entries = worker_tm.list_topic_lazyframe_cache(task_id)
    meanings_cache = worker_tm.get_topic_meanings_cache(task_id)
    if not cache_entries:
        raise HTTPException(
            status_code=404,
            detail="No cached topic snapshot found for this task. Please rerun topic modeling.",
        )
    if not meanings_cache:
        raise HTTPException(
            status_code=404,
            detail="No cached topic meanings found for this task. Please rerun topic modeling.",
        )

    meanings_lf = meanings_cache.get("lazyframe")
    if not isinstance(meanings_lf, pl.LazyFrame):
        raise HTTPException(
            status_code=500,
            detail="Cached topic meanings snapshot is invalid",
        )

    target_node_ids = request.node_ids or list(cache_entries.keys())
    if not target_node_ids:
        raise HTTPException(status_code=400, detail="No node IDs provided for detach")

    detached_nodes: list[dict[str, str]] = []
    for node_id in target_node_ids:
        cache_payload = cache_entries.get(node_id)
        if not cache_payload:
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} is not available in cached topic snapshot",
            )

        cached_lf = cache_payload.get("lazyframe")
        if not isinstance(cached_lf, pl.LazyFrame):
            raise HTTPException(
                status_code=500,
                detail=f"Cached topic snapshot for node {node_id} is invalid",
            )

        original_columns = list(cache_payload.get("original_columns") or [])
        selected_columns = list((request.selected_columns or {}).get(node_id) or [])
        if not selected_columns:
            raise HTTPException(
                status_code=400,
                detail=f"No columns selected for node {node_id}",
            )

        invalid = [col for col in selected_columns if col not in original_columns]
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid selected columns for node {node_id}: {invalid}",
            )

        if "topic" in selected_columns:
            raise HTTPException(
                status_code=400,
                detail="Original 'topic' column cannot be selected for topic detach",
            )

        topic_column_name = _resolve_topic_column_name(
            request.topic_column_name or "topic",
            set(original_columns) | set(selected_columns),
        )

        output_lf = cached_lf.select(
            [pl.col(col) for col in selected_columns]
            + [pl.col("_tm_topic").alias(topic_column_name)]
        )

        source_node = workspace_manager.get_node_from_workspace(
            user_id, workspace_id, node_id
        )
        parents = [source_node] if source_node else []
        node_name = (
            (request.new_node_names or {}).get(node_id)
            if request.new_node_names
            else None
        ) or f"{cache_payload.get('node_name') or node_id}_topic_detach"

        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=output_lf,
            node_name=node_name,
            operation="topic_modeling_detach",
            parents=parents,
        )
        if not new_node:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create detached node for {node_id}",
            )

        text_column = cache_payload.get("text_column")
        if (
            text_column
            and hasattr(new_node, "set_metadata")
            and text_column in selected_columns
        ):
            try:
                new_node.set_metadata("text_column", text_column)
            except Exception:
                pass

        meanings_node_name = f"{node_name}_topic_meanings"
        meanings_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=meanings_lf,
            node_name=meanings_node_name,
            operation="topic_modeling_meanings_detach",
            parents=[new_node],
        )
        if not meanings_node:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create topic meanings node for {node_id}",
            )

        detached_nodes.append({
            "source_node_id": node_id,
            "new_node_id": new_node.id,
            "topic_meanings_node_id": meanings_node.id,
        })

    return TopicModelingDetachResponse(
        state="successful",
        message="Topic detach completed",
        data={"detached_nodes": detached_nodes},
        metadata={"task_id": task_id},
    )
