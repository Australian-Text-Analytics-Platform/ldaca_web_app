"""Topic Modeling analysis endpoints (background-task based)."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from uuid import uuid4

import polars as pl
from docworkspace import Node
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
from ..utils import ensure_task_synced, update_workspace
from .current_tasks import get_current_task_ids_for_analysis
from .generated_columns import TOPIC_COLUMN, TOPIC_MEANING_COLUMN

router = APIRouter(prefix="/workspaces", tags=["topic-modeling"])
logger = logging.getLogger(__name__)

_TOPIC_SUBMISSION_LOCKS: dict[tuple[str, str], asyncio.Lock] = {}


def _topic_submission_lock(user_id: str, workspace_id: str) -> asyncio.Lock:
    key = (user_id, workspace_id)
    lock = _TOPIC_SUBMISSION_LOCKS.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _TOPIC_SUBMISSION_LOCKS[key] = lock
    return lock


def _prepare_topic_artifact_target(user_id: str, workspace_id: str) -> tuple[Path, str]:
    workspace_artifacts_dir = workspace_manager.ensure_workspace_artifacts_dir(
        user_id, workspace_id
    )
    if workspace_artifacts_dir is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    artifact_prefix = f"topic_modeling_{uuid4()}"
    return workspace_artifacts_dir, artifact_prefix


def _task_result_payload(task: AnalysisTask) -> dict:
    if task.result is None:
        return {}
    payload = task.result.to_json()
    if not isinstance(payload, dict):
        return {}
    return payload


def _topic_artifacts_from_task(task: AnalysisTask) -> dict:
    payload = _task_result_payload(task)
    artifacts = payload.get("artifacts")
    if not isinstance(artifacts, dict):
        raise HTTPException(
            status_code=404,
            detail="Topic modeling artifacts are not available for this task",
        )
    node_artifacts = artifacts.get("nodes")
    meanings_path = artifacts.get("topic_meanings_parquet_path")
    if not isinstance(node_artifacts, list) or not isinstance(meanings_path, str):
        raise HTTPException(
            status_code=500,
            detail="Topic modeling artifact manifest is invalid",
        )
    return artifacts


@router.delete("/topic-modeling")
async def clear_topic_modeling_results(
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
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)
    current_id = task_manager.get_current_task_ids("topic_modeling")
    if current_id:
        task_manager.clear_task(current_id[0])

    worker_tm = workspace_manager.get_task_manager(user_id)
    if current_id:
        await worker_tm.clear_task(current_id[0])

    return {
        "state": "successful",
        "message": "Topic modeling analysis results have been cleared.",
    }


@router.post("/topic-modeling", response_model=TopicModelingResponse)
async def run_topic_modeling(
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
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    if not request.node_ids:
        raise HTTPException(
            status_code=400, detail="At least one node ID must be provided"
        )

    for nid in request.node_ids:
        if nid not in request.node_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Missing text column selection for node {nid}",
            )

    corpora: list[list[str]] = []
    node_infos: list[dict[str, object]] = []
    for node_id in request.node_ids:
        try:
            node = ws.nodes[node_id]
        except Exception:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        node_data = getattr(node, "data", None)
        if not isinstance(node_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} data must be a LazyFrame",
            )

        column_name = request.node_columns[node_id]
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
    tm = workspace_manager.get_task_manager(user_id)
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

        artifact_dir, artifact_prefix = _prepare_topic_artifact_target(
            user_id, workspace_id
        )
        worker_task = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="topic_modeling",
            task_args={
                "corpora": corpora,
                "node_infos": node_infos,
                "artifact_dir": str(artifact_dir),
                "artifact_prefix": artifact_prefix,
                "min_topic_size": request.min_topic_size,
                "random_seed": request.random_seed,
                "representative_words_count": request.representative_words_count,
            },
            task_name="Topic Modeling",
        )

    analysis_tm = get_task_manager(user_id)
    analysis_request = AnalysisTopicModelingRequest(
        node_ids=request.node_ids,
        node_columns=request.node_columns,
        min_topic_size=request.min_topic_size,
        random_seed=request.random_seed,
        representative_words_count=request.representative_words_count,
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


@router.get("/topic-modeling/tasks/current")
async def topic_modeling_current_tasks(
    current_user: dict = Depends(get_current_user),
):
    """Return current task IDs for topic-modeling analysis."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    return await get_current_task_ids_for_analysis(
        user_id, workspace_id, ["topic_modeling", "topic-modeling"]
    )


@router.get("/topic-modeling/tasks/{task_id}/request")
async def topic_modeling_task_request(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return stored request payload for a topic-modeling task."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    request = task.request
    return request.model_dump()


@router.get(
    "/topic-modeling/tasks/{task_id}/result",
    response_model=TopicModelingResponse,
)
async def topic_modeling_task_result(
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
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task = await ensure_task_synced(
        user_id, workspace_id, task_id, get_task_manager(user_id)
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
    """Return a unique output column name for detached topic data.

    Used by:
    - `detach_topic_modeling`

    Why:
    - Prevents overwriting source columns when attaching generated topic labels.
    """
    candidate = base_name.strip() or TOPIC_COLUMN
    if candidate not in existing_columns:
        return candidate
    idx = 1
    while f"{candidate}_{idx}" in existing_columns:
        idx += 1
    return f"{candidate}_{idx}"


@router.get(
    "/topic-modeling/tasks/{task_id}/detach-options",
    response_model=TopicModelingDetachOptionsResponse,
)
async def topic_modeling_detach_options(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """List detachable node/column options for a completed topic task.

    Used by:
    - Frontend detach-options route:
        `GET /workspaces/{id}/topic-modeling/tasks/{task_id}/detach-options`

    Why:
    - Exposes artifact-backed node metadata so users can choose output columns safely.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    analysis_tm = get_task_manager(user_id)
    task = await ensure_task_synced(user_id, workspace_id, task_id, analysis_tm)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != AnalysisStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Topic modeling task is not completed",
        )

    artifacts = _topic_artifacts_from_task(task)
    node_artifacts = artifacts.get("nodes") or []

    nodes = []
    for payload in node_artifacts:
        if not isinstance(payload, dict):
            continue
        node_id = payload.get("node_id")
        if not isinstance(node_id, str) or not node_id:
            continue
        try:
            source_node = ws.nodes[node_id]
        except Exception:
            continue
        source_data = getattr(source_node, "data", None)
        if not isinstance(source_data, pl.LazyFrame):
            continue
        original_columns = list(source_data.collect_schema().names())
        topic_column_name = _resolve_topic_column_name(
            TOPIC_COLUMN, set(original_columns)
        )
        nodes.append({
            "node_id": source_node.id,
            "node_name": payload.get("node_name") or node_id,
            "text_column": payload.get("text_column"),
            "available_columns": [topic_column_name, *original_columns],
            "disabled_columns": [topic_column_name],
        })

    return TopicModelingDetachOptionsResponse(
        state="successful",
        message="Topic detach options loaded",
        data={"nodes": nodes},
        metadata={"task_id": task_id},
    )


@router.post(
    "/topic-modeling/tasks/{task_id}/detach",
    response_model=TopicModelingDetachResponse,
)
async def detach_topic_modeling(
    task_id: str,
    request: TopicModelingDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create detached nodes from artifact-backed topic-modeling outputs.

    Used by:
    - Frontend detach route:
        `POST /workspaces/{id}/topic-modeling/tasks/{task_id}/detach`

        Why:
        - Materializes user-selected columns and topic labels as reusable workspace
            nodes without rerunning the model.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    analysis_tm = get_task_manager(user_id)
    task = await ensure_task_synced(user_id, workspace_id, task_id, analysis_tm)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status != AnalysisStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail="Topic modeling task is not completed",
        )

    artifacts = _topic_artifacts_from_task(task)
    node_artifacts = artifacts.get("nodes") or []
    assignments_by_node_id = {
        str(payload.get("node_id")): payload
        for payload in node_artifacts
        if isinstance(payload, dict) and payload.get("node_id")
    }
    meanings_path = Path(str(artifacts.get("topic_meanings_parquet_path")))
    if not meanings_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Topic meanings artifact is missing",
        )
    meanings_lf = pl.scan_parquet(meanings_path)
    selected_topic_ids = sorted({
        int(topic_id) for topic_id in (request.topic_ids or [])
    })
    filtered_meanings_lf = (
        meanings_lf.filter(pl.col(TOPIC_COLUMN).is_in(selected_topic_ids))
        if selected_topic_ids
        else meanings_lf
    ).select(pl.col(TOPIC_COLUMN), pl.col(TOPIC_MEANING_COLUMN))

    target_node_ids = request.node_ids or list(assignments_by_node_id.keys())
    if not target_node_ids:
        raise HTTPException(status_code=400, detail="No node IDs provided for detach")

    detached_nodes: list[dict[str, str]] = []
    for node_id in target_node_ids:
        artifact_payload = assignments_by_node_id.get(node_id)
        if not artifact_payload:
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} is not available in topic artifact manifest",
            )

        assignments_path = Path(str(artifact_payload.get("assignments_parquet_path")))
        if not assignments_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Topic assignments artifact missing for node {node_id}",
            )
        assignments_lf = pl.scan_parquet(assignments_path)

        # Filter assignments to selected topics if topic_ids specified
        join_how = "left"
        if selected_topic_ids:
            assignments_lf = assignments_lf.filter(
                pl.col(TOPIC_COLUMN).is_in(selected_topic_ids)
            )
            join_how = "inner"

        try:
            source_node = ws.nodes[node_id]
        except Exception:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
        source_data = getattr(source_node, "data", None)
        if not isinstance(source_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} data must be a LazyFrame",
            )

        original_columns = list(source_data.collect_schema().names())
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

        topic_column_name = _resolve_topic_column_name(
            request.topic_column_name or TOPIC_COLUMN,
            set(original_columns) | set(selected_columns),
        )

        output_lf = (
            source_data
            .with_row_index("__row_nr__")
            .join(assignments_lf, on="__row_nr__", how=join_how)
            .select(
                [pl.col(col) for col in selected_columns]
                + [pl.col(TOPIC_COLUMN).alias(topic_column_name)]
            )
        )

        parents = [source_node] if source_node else []
        node_name = (
            (request.new_node_names or {}).get(node_id)
            if request.new_node_names
            else None
        ) or f"{artifact_payload.get('node_name') or node_id}_topic_detach"

        new_node = Node(
            data=output_lf,
            name=node_name,
            workspace=ws,
            operation="topic_modeling_detach",
            parents=parents,
        )
        ws.add_node(new_node)

        text_column = artifact_payload.get("text_column")
        if text_column and text_column in selected_columns:
            try:
                new_node.document = text_column
            except Exception as exc:
                logger.debug(
                    "Failed to set detached topic node document column '%s' for node %s: %s",
                    text_column,
                    new_node.id,
                    exc,
                )

        meanings_node_name = f"{node_name}_topic_meanings"
        meanings_node = Node(
            data=filtered_meanings_lf,
            name=meanings_node_name,
            workspace=ws,
            operation="topic_modeling_meanings_detach",
            parents=[new_node],
        )
        ws.add_node(meanings_node)

        detached_nodes.append({
            "source_node_id": node_id,
            "new_node_id": new_node.id,
            "topic_meanings_node_id": meanings_node.id,
        })

    update_workspace(user_id, workspace_id, ws)

    return TopicModelingDetachResponse(
        state="successful",
        message="Topic detach completed",
        data={"detached_nodes": detached_nodes},
        metadata={"task_id": task_id},
    )
