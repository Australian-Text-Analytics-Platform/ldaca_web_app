"""Quotation analysis endpoints with on-demand paginated result retrieval."""

from __future__ import annotations

import logging
from typing import Any, Optional

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.quotation import \
    QuotationRequest as AnalysisQuotationRequest
from ....analysis.manager import get_task_manager
from ....analysis.results import GenericAnalysisResult
from ....core.analysis_helpers import \
    normalize_sort_order as _normalize_sort_order
from ....core.auth import get_current_user
from ....core.services.quotation_client import (QuotationServiceError,
                                                extract_remote_quotations)
from ....core.workspace import workspace_manager
from ....models import (QuotationDetachRequest, QuotationEngineConfig,
                        QuotationRequest, QuotationResultQuery)
from ....settings import settings
from ..utils import get_node_with_data_or_400, get_workspace_or_404
from . import quotation_core as qcore

logger = logging.getLogger(__name__)

DEFAULT_CONTEXT_LENGTH = qcore.DEFAULT_CONTEXT_LENGTH
DEFAULT_PAGE_SIZE = qcore.DEFAULT_PAGE_SIZE

# Backward-compatible test hooks (tests patch these names directly)
_prepare_documents_payload = qcore.prepare_documents_payload
_normalize_context_length = qcore.normalize_context_length
_normalize_pagination = qcore.normalize_pagination
_extract_context_preference = qcore.extract_context_preference


async def _compute_quote_dataframe(
    node: Any,
    base_df: pl.DataFrame,
    column: str,
    engine: QuotationEngineConfig,
    *,
    use_base_only: bool = False,
) -> pl.DataFrame:
    """Compatibility wrapper that preserves monkeypatch points in tests."""
    return await qcore.compute_quote_dataframe(
        node,
        base_df,
        column,
        engine,
        use_base_only=use_base_only,
        extract_remote_fn=extract_remote_quotations,
        quotation_service_max_batch_size=settings.quotation_service_max_batch_size,
        quotation_service_timeout=settings.quotation_service_timeout,
    )


async def _compute_on_demand_page(
    node: Any,
    column: str,
    engine: QuotationEngineConfig,
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    sort_order: str,
) -> dict[str, Any]:
    return await qcore.compute_on_demand_page(
        node,
        column,
        engine,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        compute_quote_dataframe_fn=_compute_quote_dataframe,
        normalize_sort_order_fn=_normalize_sort_order,
    )


router = APIRouter(prefix="/workspaces", tags=["quotation"])


@router.get("/{workspace_id}/quotation/tasks/{task_id}/result")
async def quotation_task_result(
    workspace_id: str,
    task_id: str,
    page: Optional[int] = None,
    page_size: Optional[int] = None,
    sort_by: Optional[str] = None,
    sort_order: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)
    task = task_manager.get_task(task_id)
    if not task or not task.result:
        return None

    base_result = task.result.to_json()
    req_dict = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )

    if any(v is not None for v in (page, page_size, sort_by, sort_order)):
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

        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            return base_result

        normalized_page, normalized_size = _normalize_pagination(
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
            sort_order=_normalize_sort_order(sort_order),
        )

    return base_result


@router.post("/{workspace_id}/quotation/tasks/{task_id}/result")
async def update_quotation_task_result(
    workspace_id: str,
    task_id: str,
    query: QuotationResultQuery,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    task_manager = get_task_manager(user_id, workspace_id)
    task = task_manager.get_task(task_id)
    if not task or not task.result:
        raise HTTPException(status_code=404, detail="No quotation analysis found")

    base_request = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    base_result = task.result.to_json()

    context_length_value = _extract_context_preference(base_result)
    if query.context_length is not None:
        context_length_value = _normalize_context_length(query.context_length)

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
            for value in (query.page, query.page_size, query.sort_by, query.sort_order)
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

    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    normalized_page, normalized_size = _normalize_pagination(
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
        sort_order=_normalize_sort_order(query.sort_order),
    )

    updated_result = {**page_payload, "preferences": preferences}

    try:
        task.complete(GenericAnalysisResult(updated_result))
        if hasattr(task.request, "page"):
            task.request.page = normalized_page
            task.request.page_size = normalized_size
            task.request.sort_by = query.sort_by or None
            task.request.sort_order = _normalize_sort_order(query.sort_order)

        task_manager.save_task(task)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist quotation pagination update: {exc}",
        )

    return updated_result


@router.post("/{workspace_id}/nodes/{node_id}/quotation")
async def get_quotation(
    workspace_id: str,
    node_id: str,
    request: QuotationRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    get_workspace_or_404(user_id, workspace_id)

    task_manager = get_task_manager(user_id, workspace_id)

    try:
        node, _node_data = get_node_with_data_or_400(user_id, workspace_id, node_id)
        engine = request.engine or QuotationEngineConfig()

        page, page_size = _normalize_pagination(request.page, request.page_size)

        page_payload = await _compute_on_demand_page(
            node,
            request.column,
            engine,
            page=page,
            page_size=page_size,
            sort_by=request.sort_by or None,
            sort_order=_normalize_sort_order(request.sort_order),
        )

        context_length_pref = DEFAULT_CONTEXT_LENGTH
        try:
            prev_task_ids = task_manager.get_current_task_ids("quotation")
            prev_task = (
                task_manager.get_task(prev_task_ids[0]) if prev_task_ids else None
            )
            if prev_task and prev_task.result:
                prev_result = prev_task.result.to_json()
                context_length_pref = _extract_context_preference(prev_result)
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
            sort_order=_normalize_sort_order(request.sort_order),
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

            existing_task.request = analysis_request
            existing_task.complete(GenericAnalysisResult(result_payload))
            task_manager.save_task(existing_task)

        else:
            task_id = task_manager.create_task(analysis_request)
            task = task_manager.get_task(task_id)
            task.request = analysis_request
            task.complete(GenericAnalysisResult(result_payload))
            task_manager.save_task(task)
            task_manager.set_current_task("quotation", task_id)

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


@router.post("/{workspace_id}/nodes/{node_id}/quotation/detach")
async def detach_quotation(
    workspace_id: str,
    node_id: str,
    request: QuotationDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    tm = workspace_manager.get_task_manager(user_id, workspace_id)

    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        task_info = await tm.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="quotation_detach",
            task_args={
                "node_id": node_id,
                "column": request.column,
                "engine_config": request.engine.model_dump() if request.engine else {},
                "new_node_name": request.new_node_name,
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
        )
        }

    except Exception as exc:
        logger.exception("Error submitting detach quotation task")
        raise HTTPException(
            status_code=500, detail=f"Error submitting detach task: {exc}"
        )
