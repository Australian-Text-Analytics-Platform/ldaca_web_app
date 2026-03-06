"""AI Annotation analysis endpoints.

Includes:
    - POST /workspaces/ai-annotation/models  (list models for a given endpoint)
    - POST /workspaces/ai-annotation          (run classification)
    - DELETE /workspaces/ai-annotation        (clear results)
    - GET  /workspaces/ai-annotation/tasks/current
    - GET  /workspaces/ai-annotation/tasks/{task_id}/request
    - GET  /workspaces/ai-annotation/tasks/{task_id}/result
    - POST /workspaces/ai-annotation/tasks/{task_id}/result
    - POST /workspaces/nodes/{node_id}/ai-annotation/detach
    - POST /workspaces/nodes/{node_id}/ai-annotation/save
    - GET  /workspaces/nodes/{node_id}/ai-annotation/providers
    - GET  /workspaces/nodes/{node_id}/ai-annotation/categories
"""

from __future__ import annotations

import logging
import math
from typing import Any, Dict, List, Optional
from uuid import uuid4

import polars as pl
from fastapi import APIRouter, Depends, HTTPException, Query

from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import (
    AiAnnotationDetachRequest,
    AiAnnotationModelsRequest,
    AiAnnotationRequest,
    AiAnnotationResponse,
    AiAnnotationResultQuery,
    AiAnnotationSaveRequest,
)
from ..utils import update_workspace
from .ai_annotation_core import classify_texts, list_models
from .current_tasks import get_current_task_ids_for_analysis

router = APIRouter(prefix="/workspaces", tags=["ai-annotation"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _paginate_results(
    items: List[Dict[str, Any]],
    page: int = 1,
    page_size: int = 20,
    sort_by: Optional[str] = None,
    descending: bool = True,
    total_source_rows: Optional[int] = None,
) -> Dict[str, Any]:
    total = total_source_rows if total_source_rows is not None else len(items)
    total_pages = max(1, math.ceil(total / page_size))
    page = max(1, min(page, total_pages))

    if sort_by:
        items = sorted(
            items,
            key=lambda r: (r.get(sort_by) is None, r.get(sort_by, "")),
            reverse=descending,
        )

    # Items may carry a row_index from on-demand classification across pages.
    # Filter by the row_index range that corresponds to the requested page.
    start = (page - 1) * page_size
    end = start + page_size
    if any("row_index" in item for item in items):
        page_items = [
            item for item in items if start <= item.get("row_index", -1) < end
        ]
    else:
        page_items = items[start:end]

    return {
        "data": page_items,
        "columns": list(page_items[0].keys()) if page_items else [],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_source_rows": total,
            "total_source_pages": total_pages,
            "result_count": len(page_items),
            "has_next": page < total_pages,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": sort_by,
            "descending": descending,
        },
    }


async def _build_response(
    request: AiAnnotationRequest,
    task_id: str,
    page: int,
    page_size: int,
    user_id: str,
    sort_by: Optional[str] = None,
    descending: bool = True,
) -> Dict[str, Any]:
    """Compute and return only the requested page for AI annotation.

    Results are generated on demand for the requested page and are not written
    back into the stored task.
    """
    ws = workspace_manager.get_current_workspace(user_id)
    if ws is None:
        return {
            "state": "failed",
            "message": "No active workspace selected",
            "data": None,
        }

    data: Dict[str, Any] = {}
    start = (page - 1) * page_size

    classes = [c.model_dump() for c in request.classes]
    examples = [e.model_dump() for e in request.examples] if request.examples else None

    for node_id in request.node_ids:
        items: List[Dict[str, Any]] = []

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
        if column_name not in node_data.collect_schema().names():
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not in node {node_id}",
            )

        total_rows = node_data.select(pl.len()).collect().item()

        sel_df = node_data.select(pl.col(column_name)).slice(start, page_size).collect()
        texts = [
            str(v) if v is not None else ""
            for v in sel_df.get_column(column_name).to_list()
        ]

        results = await classify_texts(
            texts=texts,
            classes=classes,
            examples=examples,
            model=request.model,
            api_key=request.api_key,
            base_url=request.base_url,
            temperature=request.temperature,
            top_p=request.top_p,
            seed=request.seed,
            batch_size=page_size,
            text_column_name=column_name,
        )

        for r in results:
            r["row_index"] = start + r["row_index"]
        items.extend(results)

        data[node_id] = _paginate_results(
            items,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            descending=descending,
            total_source_rows=total_rows,
        )

    return {
        "state": "successful",
        "message": "AI annotation results",
        "data": data,
        "analysis_params": {
            "model": request.model,
            "base_url": request.base_url,
            "node_columns": request.node_columns,
        },
        "metadata": {
            "task_id": task_id,
            "annotation_columns": ["classification"],
        },
    }


# ---------------------------------------------------------------------------
# Models endpoint
# ---------------------------------------------------------------------------


@router.post("/ai-annotation/models")
async def get_ai_annotation_models(
    request: AiAnnotationModelsRequest,
    current_user: dict = Depends(get_current_user),
):
    """List available models from an OpenAI-compatible endpoint."""
    models = await list_models(
        base_url=request.base_url,
        api_key=request.api_key,
    )
    if models:
        return {
            "state": "successful",
            "message": f"Found {len(models)} models",
            "data": {"models": models},
        }
    return {
        "state": "failed",
        "message": "Could not retrieve models from the endpoint",
        "data": {"models": []},
    }


# ---------------------------------------------------------------------------
# Run / Clear
# ---------------------------------------------------------------------------


@router.post("/ai-annotation", response_model=AiAnnotationResponse)
async def run_ai_annotation(
    request: AiAnnotationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run AI annotation classification on selected nodes.

    Calls the OpenAI-compatible endpoint, stores results in
    the analysis task manager, and returns paginated output.
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
        if column_name not in node_data.collect_schema().names():
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not in node {node_id}",
            )

    task_id = str(uuid4())
    task_manager = get_task_manager(user_id)

    analysis_result = GenericAnalysisResult({
        "analysis_params": {
            "model": request.model,
            "base_url": request.base_url,
            "node_columns": request.node_columns,
        },
        "metadata": {
            "task_id": task_id,
            "annotation_columns": ["classification"],
        },
    })

    task_manager.save_task(
        AnalysisTask(
            task_id=task_id,
            user_id=user_id,
            workspace_id=workspace_id,
            request=request,
            status=AnalysisStatus.COMPLETED,
            result=analysis_result,
        )
    )
    task_manager.set_current_task("ai_annotation", task_id)

    saved_task = task_manager.get_task(task_id)
    if saved_task is None:
        raise HTTPException(status_code=500, detail="Failed to save task")

    response_data = await _build_response(
        request=request,
        task_id=task_id,
        page=request.page,
        page_size=request.page_size,
        user_id=user_id,
        sort_by=request.sort_by,
        descending=request.descending,
    )
    existing_meta = response_data.get("metadata") or {}
    existing_meta["task_id"] = task_id
    response_data["metadata"] = existing_meta
    return response_data


@router.delete("/ai-annotation")
async def clear_ai_annotation(
    current_user: dict = Depends(get_current_user),
):
    """Clear stored AI annotation task state."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)
    current_ids = task_manager.get_current_task_ids("ai_annotation")
    for tid in current_ids:
        task_manager.clear_task(tid)

    return {
        "state": "successful",
        "message": "AI annotation results have been cleared.",
    }


# ---------------------------------------------------------------------------
# Task result endpoints
# ---------------------------------------------------------------------------


@router.get("/ai-annotation/tasks/current")
async def ai_annotation_current_tasks(
    current_user: dict = Depends(get_current_user),
):
    """Return current task IDs for AI annotation analysis."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    return await get_current_task_ids_for_analysis(
        user_id, workspace_id, ["ai_annotation", "ai-annotation"]
    )


@router.get("/ai-annotation/tasks/{task_id}/request")
async def ai_annotation_task_request(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return stored request payload for an AI annotation task."""
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task.request.model_dump()


@router.get("/ai-annotation/tasks/{task_id}/result")
async def ai_annotation_task_result(
    task_id: str,
    page: Optional[int] = Query(None),
    page_size: Optional[int] = Query(None),
    sort_by: Optional[str] = Query(None),
    descending: Optional[bool] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """Read AI annotation result with optional pagination/sort overrides."""
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    return await _build_response(
        request=task.request,
        task_id=task_id,
        page=page or 1,
        page_size=page_size or 20,
        user_id=user_id,
        sort_by=sort_by,
        descending=descending if descending is not None else True,
    )


@router.post("/ai-annotation/tasks/{task_id}/result")
async def ai_annotation_task_result_post(
    task_id: str,
    query: AiAnnotationResultQuery,
    current_user: dict = Depends(get_current_user),
):
    """Read AI annotation result using POST body overrides."""
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    page = query.page or 1
    page_size = query.page_size or 20
    sort_by = query.sort_by
    descending = query.descending if query.descending is not None else True

    request = task.request.model_copy(
        update={
            "page": page,
            "page_size": page_size,
            "sort_by": sort_by,
            "descending": descending,
        }
    )

    return await _build_response(
        request=request,
        task_id=task_id,
        page=page,
        page_size=page_size,
        user_id=user_id,
        sort_by=sort_by,
        descending=descending,
    )


# ---------------------------------------------------------------------------
# Detach
# ---------------------------------------------------------------------------


@router.post("/nodes/{node_id}/ai-annotation/detach")
async def detach_ai_annotation(
    node_id: str,
    request: AiAnnotationDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run AI annotation on a node and detach the result as a new child node.

    Classifies texts using the OpenAI-compatible endpoint, writes the result
    as a parquet file, and adds it as a new node in the workspace.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = ws.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    if request.column not in node_data.collect_schema().names():
        raise HTTPException(
            status_code=400, detail=f"Column '{request.column}' not found"
        )

    sel_df = node_data.select(pl.col(request.column)).collect()
    texts = [
        str(v) if v is not None else ""
        for v in sel_df.get_column(request.column).to_list()
    ]

    classes = [c.model_dump() for c in request.classes]
    examples = [e.model_dump() for e in request.examples] if request.examples else None

    results = await classify_texts(
        texts=texts,
        classes=classes,
        examples=examples,
        model=request.model,
        api_key=request.api_key,
        base_url=request.base_url,
        temperature=request.temperature,
        top_p=request.top_p,
        seed=request.seed,
        batch_size=request.batch_size,
        text_column_name=request.column,
    )

    annotation_col = request.annotation_column or "ai_annotation"
    result_df = pl.DataFrame({
        request.column: [r[request.column] for r in results],
        annotation_col: [r["classification"] for r in results],
    })

    artifact_dir = workspace_manager.ensure_workspace_artifacts_dir(
        user_id, workspace_id
    )
    if artifact_dir is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    artifact_path = artifact_dir / f"ai_annotation_detach_{uuid4().hex}.parquet"
    result_df.write_parquet(str(artifact_path))

    from docworkspace import Node as DwNode

    new_name = request.new_node_name or f"{getattr(node, 'name', node_id)}_annotated"
    lazy_result = pl.scan_parquet(str(artifact_path))
    new_node = DwNode(data=lazy_result, name=new_name)

    try:
        ws.add_node(new_node, parent=node_id)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to add detached node: {exc}",
        )

    update_workspace(user_id, workspace_id, best_effort=True)

    return {
        "state": "successful",
        "message": f"AI annotation detached as '{new_name}'",
        "data": {"new_node_name": new_name, "record_count": len(result_df)},
    }


# ---------------------------------------------------------------------------
# Save annotations to existing node
# ---------------------------------------------------------------------------


@router.post("/nodes/{node_id}/ai-annotation/save")
async def save_ai_annotation(
    node_id: str,
    request: AiAnnotationSaveRequest,
    current_user: dict = Depends(get_current_user),
):
    """Save AI annotation edits back to the source node."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = ws.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(status_code=400, detail="Node data must be a LazyFrame")

    annotation_col = request.annotation_column or "ai_annotation"
    df = node_data.collect()

    if annotation_col not in df.columns:
        df = df.with_columns(pl.lit(None).cast(pl.Utf8).alias(annotation_col))

    annotations = df[annotation_col].to_list()
    for edit in request.edits:
        if 0 <= edit.row_index < len(annotations):
            annotations[edit.row_index] = edit.annotation

    df = df.with_columns(pl.Series(annotation_col, annotations))

    artifact_dir = workspace_manager.ensure_workspace_artifacts_dir(
        user_id, workspace_id
    )
    if artifact_dir is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    artifact_path = artifact_dir / f"ai_annotation_save_{uuid4().hex}.parquet"
    df.write_parquet(str(artifact_path))
    node.data = pl.scan_parquet(str(artifact_path))

    update_workspace(user_id, workspace_id, best_effort=True)

    return {
        "state": "successful",
        "message": "Annotations saved",
        "data": {
            "annotation_column": annotation_col,
            "edits_applied": len(request.edits),
        },
    }


# ---------------------------------------------------------------------------
# Node-scoped metadata
# ---------------------------------------------------------------------------


@router.get("/nodes/{node_id}/ai-annotation/providers")
async def get_ai_annotation_providers(
    node_id: str,
    annotation_column: str = Query("ai_annotation"),
    current_user: dict = Depends(get_current_user),
):
    """Return distinct provider values from the annotation column of a node."""
    user_id = current_user["id"]
    ws = workspace_manager.get_current_workspace(user_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = ws.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        return {"state": "successful", "data": {"providers": []}}

    cols = node_data.collect_schema().names()
    if annotation_column not in cols:
        return {"state": "successful", "data": {"providers": []}}

    values = (
        node_data
        .select(pl.col(annotation_column))
        .collect()
        .get_column(annotation_column)
        .drop_nulls()
        .unique()
        .to_list()
    )
    return {
        "state": "successful",
        "data": {"providers": sorted(str(v) for v in values)},
    }


@router.get("/nodes/{node_id}/ai-annotation/categories")
async def get_ai_annotation_categories(
    node_id: str,
    annotation_column: str = Query("ai_annotation"),
    current_user: dict = Depends(get_current_user),
):
    """Return distinct category values from the annotation column of a node."""
    user_id = current_user["id"]
    ws = workspace_manager.get_current_workspace(user_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = ws.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        return {"state": "successful", "data": {"categories": []}}

    cols = node_data.collect_schema().names()
    if annotation_column not in cols:
        return {"state": "successful", "data": {"categories": []}}

    values = (
        node_data
        .select(pl.col(annotation_column))
        .collect()
        .get_column(annotation_column)
        .drop_nulls()
        .unique()
        .to_list()
    )
    return {
        "state": "successful",
        "data": {"categories": sorted(str(v) for v in values)},
    }
