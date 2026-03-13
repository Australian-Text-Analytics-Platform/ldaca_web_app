"""Quotation analysis endpoints with on-demand paginated result retrieval."""

from __future__ import annotations

import logging
from functools import partial
from typing import Any, Optional

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.quotation import (
    QuotationRequest as AnalysisQuotationRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.services.quotation_client import (
    QuotationServiceError,
    extract_remote_quotations,
)
from ....core.workspace import workspace_manager
from ....models import (
    QuotationDetachNodeOption,
    QuotationDetachOptionsResponse,
    QuotationDetachRequest,
    QuotationEngineConfig,
    QuotationRequest,
    QuotationResultQuery,
)
from ....settings import settings
from ..utils import update_workspace
from . import quotation_core as qcore
from .current_tasks import get_current_task_ids_for_analysis

logger = logging.getLogger(__name__)

DEFAULT_CONTEXT_LENGTH = qcore.DEFAULT_CONTEXT_LENGTH
DEFAULT_PAGE_SIZE = qcore.DEFAULT_PAGE_SIZE
DEFAULT_DESCENDING = qcore.DEFAULT_DESCENDING
CORE_QUOTATION_COLUMNS = list(qcore.QUOTE_COLUMN_NAMES)


async def _compute_on_demand_page(
    node: Any,
    column: str,
    engine: QuotationEngineConfig,
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    descending: bool,
) -> dict[str, Any]:
    """Compute paged quotation payloads via shared quotation-core helper.

    Used by:
    - `quotation_task_result`
    - `update_quotation_task_result`
    - `get_quotation`

    Why:
    - Centralizes paging/sorting computation across read/update/run flows.
    """
    compute_quote_dataframe_fn = partial(
        qcore.compute_quote_dataframe,
        extract_remote_fn=extract_remote_quotations,
        quotation_service_max_batch_size=settings.quotation_service_max_batch_size,
        quotation_service_timeout=settings.quotation_service_timeout,
    )

    return await qcore.compute_on_demand_page(
        node,
        column,
        engine,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        descending=descending,
        compute_quote_dataframe_fn=compute_quote_dataframe_fn,
    )


router = APIRouter(prefix="/workspaces", tags=["quotation"])


@router.get("/quotation/tasks/current")
async def quotation_current_tasks(
    current_user: dict = Depends(get_current_user),
):
    """Return current task IDs for quotation analysis."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    return await get_current_task_ids_for_analysis(
        user_id, workspace_id, ["quotation_analysis", "quotation-analysis", "quotation"]
    )


@router.get("/quotation/tasks/{task_id}/request")
async def quotation_task_request(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return stored request payload for a quotation task."""
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


@router.get("/quotation/tasks/{task_id}/result")
async def quotation_task_result(
    task_id: str,
    page: Optional[int] = None,
    page_size: Optional[int] = None,
    sort_by: Optional[str] = None,
    descending: Optional[bool] = None,
    current_user: dict = Depends(get_current_user),
):
    """Return stored quotation result, optionally recomputed for new page params.

    Used by:
    - frontend polling route for quotation result panels

    Why:
    - Supports cheap preference-only reads and on-demand page recomputation.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if not task or not task.result:
        return None

    base_result = task.result.to_json()
    req_dict = task.request.model_dump()

    if any(v is not None for v in (page, page_size, sort_by, descending)):
        node_id = req_dict.get("node_id")
        column = req_dict.get("column")
        if not node_id or not column:
            return base_result

        engine_dict = req_dict.get("engine") or {}
        engine_dict = {
            k: v for k, v in engine_dict.items() if k not in ("api_key", "model")
        }
        try:
            engine = QuotationEngineConfig.model_validate(engine_dict)
        except Exception:
            return base_result

        try:
            node = ws.nodes[node_id]
        except Exception:
            return base_result

        normalized_page, normalized_size = qcore.normalize_pagination(
            page if page is not None else 1,
            page_size if page_size is not None else DEFAULT_PAGE_SIZE,
        )

        return await _compute_on_demand_page(
            node,
            column,
            engine,
            page=normalized_page,
            page_size=normalized_size,
            sort_by=sort_by or None,
            descending=descending if descending is not None else DEFAULT_DESCENDING,
        )

    return base_result


@router.post("/quotation/tasks/{task_id}/result")
async def update_quotation_task_result(
    task_id: str,
    query: QuotationResultQuery,
    current_user: dict = Depends(get_current_user),
):
    """Persist quotation display preferences and optional page overrides.

    Used by:
    - frontend preference updates for context length/sort/page controls

    Why:
    - Lets UI tune quotation presentation without rerunning analysis creation.

    Refactor note:
    - Shares substantial logic with `quotation_task_result`; both could delegate
      to a single internal read/update orchestrator.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if not task or not task.result:
        raise HTTPException(status_code=404, detail="No quotation analysis found")

    base_request = task.request.model_dump()
    base_result = task.result.to_json()

    context_length_value = qcore.extract_context_preference(base_result)
    if query.context_length is not None:
        context_length_value = qcore.normalize_context_length(query.context_length)

    preferences = {
        **(
            base_result.get("preferences")
            if isinstance(base_result.get("preferences"), dict)
            else {}
        ),
        "context_length": context_length_value,
    }

    needs_pagination = (
        any(
            value is not None
            for value in (query.page, query.page_size, query.sort_by, query.descending)
        )
        and not query.update_only
    )

    if not needs_pagination:
        base_result["preferences"] = preferences
        try:
            task.complete(GenericAnalysisResult(base_result))
            task_manager.save_task(task)
        except Exception as exc:  # pragma: no cover
            raise HTTPException(
                status_code=500,
                detail=f"Failed to persist quotation preferences: {exc}",
            )

        return {
            "state": "successful",
            "message": "saved",
            "data": {"context_length": context_length_value},
        }

    node_id = base_request.get("node_id")
    column = base_request.get("column")
    if not node_id or not column:
        raise HTTPException(
            status_code=404, detail="No quotation analysis found for this workspace"
        )

    engine_dict = base_request.get("engine") or {}
    engine_dict = {
        k: v for k, v in engine_dict.items() if k not in ("api_key", "model")
    }
    try:
        engine = QuotationEngineConfig.model_validate(engine_dict)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=400, detail=f"Invalid engine config: {exc}")

    try:
        node = ws.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    normalized_page, normalized_size = qcore.normalize_pagination(
        query.page if query.page is not None else 1,
        query.page_size if query.page_size is not None else DEFAULT_PAGE_SIZE,
    )

    page_payload = await _compute_on_demand_page(
        node,
        column,
        engine,
        page=normalized_page,
        page_size=normalized_size,
        sort_by=query.sort_by or None,
        descending=(
            query.descending if query.descending is not None else DEFAULT_DESCENDING
        ),
    )

    updated_result = {**page_payload, "preferences": preferences}

    try:
        task.complete(GenericAnalysisResult(updated_result))
        if hasattr(task.request, "page"):
            task.request.page = normalized_page
            task.request.page_size = normalized_size
            task.request.sort_by = query.sort_by or None
            task.request.descending = (
                query.descending if query.descending is not None else DEFAULT_DESCENDING
            )

        task_manager.save_task(task)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist quotation pagination update: {exc}",
        )

    return updated_result


@router.post("/nodes/{node_id}/quotation")
async def get_quotation(
    node_id: str,
    request: QuotationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run quotation extraction on selected node and store latest task payload.

    Used by:
    - frontend quotation run/search action

    Why:
    - Produces immediate result payload and persists it as current quotation task.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)

    try:
        node = workspace_manager.get_current_workspace(user_id).nodes[node_id]
        try:
            node.document = request.column
            update_workspace(user_id, workspace_id, best_effort=True)
        except Exception:
            # Best-effort persistence only; do not block analysis.
            pass

        engine = request.engine or QuotationEngineConfig()

        page, page_size = qcore.normalize_pagination(request.page, request.page_size)

        page_payload = await _compute_on_demand_page(
            node,
            request.column,
            engine,
            page=page,
            page_size=page_size,
            sort_by=request.sort_by or None,
            descending=request.descending,
        )

        context_length_pref = DEFAULT_CONTEXT_LENGTH
        try:
            prev_task_ids = task_manager.get_current_task_ids("quotation")
            prev_task = (
                task_manager.get_task(prev_task_ids[0]) if prev_task_ids else None
            )
            if prev_task and prev_task.result:
                prev_result = prev_task.result.to_json()
                context_length_pref = qcore.extract_context_preference(prev_result)
        except Exception:  # pragma: no cover
            context_length_pref = DEFAULT_CONTEXT_LENGTH

        result_payload = {
            **page_payload,
            "preferences": {"context_length": context_length_pref},
        }

        analysis_request = AnalysisQuotationRequest(
            node_id=node_id,
            column=request.column,
            engine=request.engine.model_dump(mode="json") if request.engine else None,
            page=page,
            page_size=page_size,
            sort_by=request.sort_by or None,
            descending=request.descending,
            context_length=context_length_pref,
        )

        existing_task_ids = task_manager.get_current_task_ids("quotation")
        existing_task = (
            task_manager.get_task(existing_task_ids[0]) if existing_task_ids else None
        )

        if existing_task:
            existing_req = existing_task.request
            if existing_req.node_id != node_id or existing_req.column != request.column:
                raise HTTPException(
                    status_code=409,
                    detail="Clear current quotation results before starting a new quotation analysis",
                )

            task = existing_task
            task.request = analysis_request
            task.complete(GenericAnalysisResult(result_payload))
            task_manager.save_task(task)

        else:
            task_id = task_manager.create_task(analysis_request)
            task = task_manager.get_task(task_id)
            task.request = analysis_request
            task.complete(GenericAnalysisResult(result_payload))
            task_manager.save_task(task)
            task_manager.set_current_task("quotation", task_id)

        result_payload["metadata"] = {"task_id": task.task_id}
        return result_payload
    except HTTPException:
        raise
    except QuotationServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # pragma: no cover
        logger.exception("Unexpected quotation error")
        raise HTTPException(status_code=500, detail=f"Internal server error: {exc}")


@router.get(
    "/nodes/{node_id}/quotation/detach-options",
    response_model=QuotationDetachOptionsResponse,
)
async def quotation_detach_options(
    node_id: str,
    column: str,
    current_user: dict = Depends(get_current_user),
):
    """Return detachable quotation columns for one node.

    Used by:
    - Frontend quotation detach dialog

    Why:
    - Keeps mandatory generated quotation columns and optional source columns
      aligned with backend detach behavior.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = ws.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    available_schema_columns = list(node_data.collect_schema().names())
    if column not in available_schema_columns:
        raise HTTPException(status_code=400, detail=f"Column '{column}' not found")

    mandatory_set = set(CORE_QUOTATION_COLUMNS)
    optional_columns = [
        col for col in [column, *available_schema_columns] if col not in mandatory_set
    ]
    ordered_available_columns = list(
        dict.fromkeys([column, *CORE_QUOTATION_COLUMNS, *optional_columns])
    )
    node_option = QuotationDetachNodeOption(
        node_id=node_id,
        node_name=getattr(node, "name", None) or node_id,
        text_column=column,
        available_columns=ordered_available_columns,
        disabled_columns=CORE_QUOTATION_COLUMNS,
    )

    return QuotationDetachOptionsResponse(
        state="successful",
        message="Quotation detach options loaded",
        data={"nodes": [node_option]},
        metadata=None,
    )


@router.post("/nodes/{node_id}/quotation/detach")
async def detach_quotation(
    node_id: str,
    request: QuotationDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit background task to detach quotations into a new workspace node.

    Used by:
    - frontend quotation detach action

    Why:
    - Offloads potentially expensive extraction/materialization to worker tasks.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    tm = workspace_manager.get_task_manager(user_id)

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

    schema_names = node_data.collect_schema().names()
    include_document_column = False
    columns_to_select: list[str] = []
    if request.selected_columns:
        for col in request.selected_columns:
            if col == request.column:
                include_document_column = True
                continue
            if col in schema_names:
                columns_to_select.append(col)

    corpus_df = (
        node_data
        .select([pl.col(request.column)] + [pl.col(col) for col in columns_to_select])
        .filter(
            pl
            .col(request.column)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .str.len_chars()
            .fill_null(0)
            > 0
        )
        .collect()
    )
    node_corpus = [
        str(value) if value is not None else ""
        for value in corpus_df.get_column(request.column).to_list()
    ]
    extra_columns_data: dict[str, list] = {}
    for col in columns_to_select:
        extra_columns_data[col] = corpus_df.get_column(col).to_list()

    workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
    if workspace_dir is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    try:
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="quotation_detach",
            task_args={
                "workspace_dir": str(workspace_dir),
                "node_corpus": node_corpus,
                "parent_node_id": node_id,
                "document_column": request.column,
                "engine_config": request.engine.model_dump() if request.engine else {},
                "new_node_name": request.new_node_name,
                "include_document_column": include_document_column,
                "extra_columns_data": extra_columns_data or None,
            },
            task_name="Detach Quotation",
        )

        return {
            "state": "running",
            "message": "Quotation detach started",
            "data": None,
            "metadata": {"task_id": task_info.id},
        }

    except Exception as exc:
        logger.exception("Error submitting detach quotation task")
        raise HTTPException(
            status_code=500, detail=f"Error submitting detach task: {exc}"
        )
