"""Quotation analysis endpoints extracted from monolithic base workspace router.

Provides:
  - GET /workspaces/{workspace_id}/quotation/current-request
  - GET /workspaces/{workspace_id}/quotation/current-result
  - POST /workspaces/{workspace_id}/nodes/{node_id}/quotation
  - POST /workspaces/{workspace_id}/nodes/{node_id}/quotation/detach

Behavior mirrors original implementation in base.py (lines ~3720–4035 before extraction):
  * Uses docframe text namespace `.quotation` with explode+unnest
  * Joins original node metadata columns
  * Supports pagination & optional sorting
  * Persists request/result via analysis_store (best-effort)
  * Detach operation creates a new workspace node with quotation-expanded data

Path parity is preserved (router prefix set to /workspaces like other analysis modules),
so no frontend or test changes required.
"""

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import QuotationDetachRequest, QuotationRequest

router = APIRouter(prefix="/workspaces", tags=["quotation"])  # maintain path parity


@router.get("/{workspace_id}/quotation/current-request")
async def quotation_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:  # pragma: no cover - unlikely import error
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="quotation")
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.request}


@router.get("/{workspace_id}/quotation/current-result")
async def quotation_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="quotation")
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.result}


@router.post("/{workspace_id}/quotation/clear")
async def clear_quotation_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import clear_analyses
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")

    removed = clear_analyses(user_id, workspace_id, task="quotation")
    return {"state": "successful", "cleared": {"analyses_removed": removed}}


@router.post("/{workspace_id}/nodes/{node_id}/quotation")
async def get_quotation(
    workspace_id: str,
    node_id: str,
    request: QuotationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Compute quotation rows with optional metadata join, sorting, and pagination.

    Mirrors original logic from base.py; any changes must retain backward-compatible
    response shape consumed by frontend & tests.
    """
    user_id = current_user["id"]
    try:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Validate column existence
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []
        if available_columns and request.column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{request.column}' not found. Available columns: {available_columns}",
            )

        if not hasattr(node.data, "text"):
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )

        # Compute quotation exploded & unnested, preserving original document index
        base_with_idx = None
        try:
            if hasattr(node.data, "with_row_index"):
                base_with_idx = node.data.with_row_index("document_idx")
        except Exception:  # pragma: no cover
            base_with_idx = None
        if base_with_idx is not None:
            qdf = base_with_idx.text.quotation(
                column=request.column, explode=True, unnest=True
            )
        else:
            qdf = node.data.text.quotation(
                column=request.column, explode=True, unnest=True
            )

        # Always join metadata by document_idx
        cdf = qdf
        base = node.data
        if hasattr(base, "to_lazyframe"):
            base_df = base.to_lazyframe().collect()
        elif hasattr(base, "_df"):
            base_df = base._df  # type: ignore[attr-defined]
        elif hasattr(base, "collect"):
            base_df = base.collect()
        else:
            base_df = base
        if isinstance(base_df, pl.LazyFrame):
            base_df = base_df.collect()
        orig = base_df.with_row_index("document_idx")
        qdf = cdf.join(orig, on="document_idx", how="left")

        # Sorting
        if request.sort_by and request.sort_by in qdf.columns:
            qdf = qdf.sort(
                pl.col(request.sort_by),
                descending=request.sort_order.lower() == "desc",
            )

        total_rows = len(qdf)
        start_idx = (request.page - 1) * request.page_size
        end_idx = start_idx + request.page_size
        paginated = qdf.slice(start_idx, request.page_size)

        result_payload = {
            "data": paginated.to_dicts() if hasattr(paginated, "to_dicts") else [],
            "columns": list(qdf.columns) if hasattr(qdf, "columns") else [],
            "total_rows": total_rows,
            "pagination": {
                "page": request.page,
                "page_size": request.page_size,
                "total_pages": (total_rows + request.page_size - 1)
                // request.page_size,
                "has_next": end_idx < total_rows,
                "has_prev": start_idx > 0,
            },
            "sorting": {
                "sort_by": request.sort_by,
                "sort_order": request.sort_order,
            },
        }
        try:  # best-effort persistence
            from ....core.analysis_store import save_analysis

            req_dict = (
                request.model_dump()
                if hasattr(request, "model_dump")
                else request.dict()
            )
            req_dict = {**req_dict, "node_id": node_id}
            save_analysis(
                user_id=user_id,
                workspace_id=workspace_id,
                task="quotation",
                request_dict=req_dict,
                result_dict=result_payload,
            )
        except Exception:  # pragma: no cover - persistence failures ignored
            pass
        return result_payload
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover - unexpected path
        import traceback

        print(f"❌ Unexpected quotation error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{workspace_id}/nodes/{node_id}/quotation/detach")
async def detach_quotation(
    workspace_id: str,
    node_id: str,
    request: QuotationDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Detach quotation results (full-table) by joining exploded quotations with original table into a new node."""
    user_id = current_user["id"]
    try:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Column validation
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []
        if available_columns and request.column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{request.column}' not found. Available columns: {available_columns}",
            )

        if not hasattr(node.data, "text"):
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )

        # Full quotation explode+unnest
        try:
            base_with_idx = node.data.with_row_index("document_idx")
        except Exception:  # pragma: no cover
            base_with_idx = None
        if base_with_idx is not None and hasattr(base_with_idx, "text"):
            quotation_df = base_with_idx.text.quotation(
                column=request.column, explode=True, unnest=True
            )
        else:
            quotation_df = node.data.text.quotation(
                column=request.column, explode=True, unnest=True
            )

        # Ensure document_idx
        if "document_idx" not in quotation_df.columns:
            quotation_with_idx = quotation_df.with_row_index("document_idx")
        else:
            quotation_with_idx = quotation_df

        # Materialize original
        try:
            underlying_df = node.data
            if hasattr(underlying_df, "to_lazyframe"):
                underlying_df = underlying_df.to_lazyframe().collect()
            elif hasattr(underlying_df, "_df"):
                underlying_df = underlying_df._df  # type: ignore[attr-defined]
            elif hasattr(underlying_df, "collect"):
                underlying_df = underlying_df.collect()
        except Exception:
            raise HTTPException(
                status_code=500,
                detail="Failed to materialize underlying data for quotation detach",
            )
        if not isinstance(underlying_df, pl.DataFrame):
            try:
                underlying_df = pl.DataFrame(underlying_df)
            except Exception:
                raise HTTPException(
                    status_code=500, detail="Underlying data is not a DataFrame"
                )
        original_with_idx = underlying_df.with_row_index("document_idx")

        quote_cols = [
            "document_idx",
            "speaker",
            "speaker_start_idx",
            "speaker_end_idx",
            "quote",
            "quote_start_idx",
            "quote_end_idx",
            "verb",
            "verb_start_idx",
            "verb_end_idx",
            "quote_type",
            "quote_token_count",
            "is_floating_quote",
        ]
        if "quote_row_idx" not in quotation_with_idx.columns:
            quotation_with_idx = quotation_with_idx.with_row_index("quote_row_idx")
        other_df = quotation_with_idx.select([
            c
            for c in (quote_cols + ["quote_row_idx"])
            if c in quotation_with_idx.columns
        ])

        final_data = original_with_idx.join(
            other_df, on="document_idx", how="left"
        ).drop("document_idx")

        # New node name
        if request.new_node_name:
            new_node_name = request.new_node_name
        else:
            original_name = node.name if getattr(node, "name", None) else node_id
            new_node_name = f"{original_name}_quotation"

        data_for_node = final_data
        try:  # pragma: no cover - best effort docframe wrapping
            from docframe import DocDataFrame as _DDF  # type: ignore
            from docframe import DocLazyFrame as _DLF  # type: ignore

            if isinstance(node.data, (_DDF, _DLF)):
                doc_col = getattr(node.data, "document_column", None)
                if doc_col and doc_col in final_data.columns:
                    data_for_node = _DDF(final_data, document_column=doc_col)
        except Exception:
            pass

        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=data_for_node,
            node_name=new_node_name,
            operation="quotation_detach",
            parents=[node],
        )
        if not new_node:
            raise HTTPException(
                status_code=500, detail="Failed to create detached quotation node"
            )

        total_rows = final_data.height if hasattr(final_data, "height") else -1
        return {
            "state": "successful",
            "message": f"Successfully created detached quotation node '{new_node_name}' with {total_rows if total_rows >= 0 else 'unknown'} rows",
            "new_node_id": new_node.id,
            "new_node_name": new_node_name,
            "total_rows": total_rows,
        }
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        print(f"❌ Error in detach quotation: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error detaching quotation results: {str(e)}"
        )
