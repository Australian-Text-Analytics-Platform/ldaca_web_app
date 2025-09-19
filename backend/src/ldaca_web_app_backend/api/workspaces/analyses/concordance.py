"""Concordance analysis endpoints extracted from legacy monolithic base.py.

Includes:
  - POST /workspaces/{workspace_id}/nodes/{node_id}/concordance
  - GET  /workspaces/{workspace_id}/concordance/multi-node/current-request
  - GET  /workspaces/{workspace_id}/concordance/multi-node/current-result
  - POST /workspaces/{workspace_id}/concordance/multi-node/current-result
  - POST /workspaces/{workspace_id}/concordance/multi-node
  - POST /workspaces/{workspace_id}/concordance/cache/clear
  - POST /workspaces/{workspace_id}/concordance/multi-node/clear
  - GET  /workspaces/{workspace_id}/nodes/{node_id}/concordance/{document_idx}
  - POST /workspaces/{workspace_id}/nodes/{node_id}/concordance/detach

Behavior preserved exactly: caching logic, metadata detection, pagination, sorting,
multi-node combined view, persistence via analysis_store, detach semantics, and
detail retrieval endpoint. Route shapes & response payloads unchanged to avoid
frontend/test regressions.
"""

import logging
import time
from typing import Dict, Optional, Tuple

import polars as pl
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import (
    ConcordanceDetachRequest,
    ConcordanceMetadata,
    ConcordanceRequest,
    MultiNodeConcordanceRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces", tags=["concordance"])


# ---------------------------------------------------------------------------
# In-memory concordance cache (moved from base.py lines ~125-158, 549-558)
# ---------------------------------------------------------------------------
CONCORDANCE_CACHE: Dict[Tuple[str, str, str, str, str, int, int, bool, bool], dict] = {}


def _concordance_cache_key(
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
):
    return (
        user_id,
        workspace_id,
        node_id,
        column,
        search_word,
        num_left_tokens,
        num_right_tokens,
        regex,
        case_sensitive,
    )


def _get_cached_concordance_df(key):  # pragma: no cover - simple accessor
    entry = CONCORDANCE_CACHE.get(key)
    if not entry:
        return None
    return entry.get("df")


def _store_concordance_df(key, df):  # pragma: no cover
    CONCORDANCE_CACHE[key] = {"df": df, "created": time.time()}


## Cache clearing now handled by analysis_admin.clear_concordance_cache_for


# ---------------------------------------------------------------------------
# Single-node concordance endpoint (base.py lines ~2257-2588)
# ---------------------------------------------------------------------------
@router.post("/{workspace_id}/nodes/{node_id}/concordance")
async def get_concordance(
    workspace_id: str,
    node_id: str,
    request: ConcordanceRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

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

        if hasattr(node.data, "text"):
            concordance_result = node.data.text.concordance(
                column=request.column,
                search_word=request.search_word,
                num_left_tokens=request.num_left_tokens,
                num_right_tokens=request.num_right_tokens,
                regex=request.regex,
                case_sensitive=request.case_sensitive,
                explode=True,
                unnest=True,
            )

            core_names = {
                "document_idx",
                "left_context",
                "matched_text",
                "right_context",
                "start_idx",
                "end_idx",
                "l1",
                "r1",
                "l1_freq",
                "r1_freq",
            }
            core_concordance_columns = [
                c for c in concordance_result.columns if c in core_names
            ]
            cdf = concordance_result
            if "document_idx" not in cdf.columns:
                cdf = cdf.with_row_index("document_idx")

            has_metadata = any(
                (col not in core_concordance_columns) and (col != "document_idx")
                for col in cdf.columns
            )
            if not has_metadata:
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
                try:
                    idx_dtype = cdf.schema.get("document_idx")
                    if idx_dtype is not None:
                        orig = orig.with_columns(pl.col("document_idx").cast(idx_dtype))
                except Exception:
                    pass
                cdf = cdf.join(orig, on="document_idx", how="left")

            concordance_result = cdf
            all_columns = list(concordance_result.columns)
            metadata_columns = [
                col for col in all_columns if col not in core_concordance_columns
            ]
            concordance_result = concordance_result.filter(
                pl.col("matched_text").is_not_null()
            )
            if request.sort_by and request.sort_by in concordance_result.columns:
                concordance_result = concordance_result.sort(
                    pl.col(request.sort_by),
                    descending=request.sort_order.lower() == "desc",
                )
            total_matches = len(concordance_result)
            start_idx = (request.page - 1) * request.page_size
            end_idx = start_idx + request.page_size
            paginated_result = concordance_result.slice(start_idx, request.page_size)
            metadata = ConcordanceMetadata(
                concordance_columns=core_concordance_columns,
                metadata_columns=metadata_columns,
                all_columns=all_columns,
            )
            if hasattr(paginated_result, "to_dicts"):
                result_payload = {
                    "data": paginated_result.to_dicts(),
                    "columns": all_columns,
                    "metadata": metadata.model_dump(),
                    "total_matches": total_matches,
                    "pagination": {
                        "page": request.page,
                        "page_size": request.page_size,
                        "total_pages": (total_matches + request.page_size - 1)
                        // request.page_size,
                        "has_next": end_idx < total_matches,
                        "has_prev": start_idx > 0,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
                try:  # pragma: no cover
                    from ....core.analysis_store import save_analysis

                    save_analysis(
                        user_id=user_id,
                        workspace_id=workspace_id,
                        task="concordance",
                        request_dict=request.model_dump()
                        if hasattr(request, "model_dump")
                        else request.dict(),
                        result_dict=result_payload,
                    )
                except Exception as _e:  # pragma: no cover
                    print(f"[analysis_persist] concordance save failed: {_e}")
                return result_payload
            else:
                empty_metadata = ConcordanceMetadata(
                    concordance_columns=[], metadata_columns=[], all_columns=[]
                )
                result_payload = {
                    "data": [],
                    "columns": [],
                    "metadata": empty_metadata.model_dump(),
                    "total_matches": 0,
                    "pagination": {
                        "page": 1,
                        "page_size": request.page_size,
                        "total_pages": 0,
                        "has_next": False,
                        "has_prev": False,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                    "analysis_params": {
                        "node_id": node_id,
                        "column": request.column,
                        "search_word": request.search_word,
                        "num_left_tokens": request.num_left_tokens,
                        "num_right_tokens": request.num_right_tokens,
                        "regex": request.regex,
                        "case_sensitive": request.case_sensitive,
                        "page_size": request.page_size,
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
                try:  # pragma: no cover
                    from ....core.analysis_store import save_analysis

                    save_analysis(
                        user_id=user_id,
                        workspace_id=workspace_id,
                        task="concordance",
                        request_dict=request.model_dump()
                        if hasattr(request, "model_dump")
                        else request.dict(),
                        result_dict=result_payload,
                    )
                except Exception as _e:  # pragma: no cover
                    print(f"[analysis_persist] concordance save failed: {_e}")
                return result_payload
        else:
            filtered = node.data.filter(
                pl.col(request.column).str.contains(request.search_word)
            )
            if request.sort_by and request.sort_by in filtered.columns:
                if request.sort_order.lower() == "desc":
                    filtered = filtered.sort(pl.col(request.sort_by), descending=True)
                else:
                    filtered = filtered.sort(pl.col(request.sort_by))
            total_matches = len(filtered)
            start_idx = (request.page - 1) * request.page_size
            paginated_filtered = filtered.slice(start_idx, request.page_size)
            if hasattr(paginated_filtered, "to_dicts"):
                all_columns = list(filtered.columns)
                fallback_metadata = ConcordanceMetadata(
                    concordance_columns=[],
                    metadata_columns=all_columns,
                    all_columns=all_columns,
                )
                result_payload = {
                    "data": paginated_filtered.to_dicts(),
                    "columns": all_columns,
                    "metadata": fallback_metadata.model_dump(),
                    "total_matches": total_matches,
                    "pagination": {
                        "page": request.page,
                        "page_size": request.page_size,
                        "total_pages": (total_matches + request.page_size - 1)
                        // request.page_size,
                        "has_next": start_idx + request.page_size < total_matches,
                        "has_prev": request.page > 1,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
                try:  # pragma: no cover
                    from ....core.analysis_store import save_analysis

                    save_analysis(
                        user_id=user_id,
                        workspace_id=workspace_id,
                        task="concordance",
                        request_dict=request.model_dump()
                        if hasattr(request, "model_dump")
                        else request.dict(),
                        result_dict=result_payload,
                    )
                except Exception as _e:  # pragma: no cover
                    print(f"[analysis_persist] concordance save failed: {_e}")
                return result_payload
            else:
                empty_metadata = ConcordanceMetadata(
                    concordance_columns=[], metadata_columns=[], all_columns=[]
                )
                result_payload = {
                    "data": [],
                    "columns": [],
                    "metadata": empty_metadata.model_dump(),
                    "total_matches": 0,
                    "pagination": {
                        "page": 1,
                        "page_size": request.page_size,
                        "total_pages": 0,
                        "has_next": False,
                        "has_prev": False,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
                try:  # pragma: no cover
                    from ....core.analysis_store import save_analysis

                    save_analysis(
                        user_id=user_id,
                        workspace_id=workspace_id,
                        task="concordance",
                        request_payload=request.model_dump()
                        if hasattr(request, "model_dump")
                        else request.dict(),
                        result_payload=result_payload,
                    )
                except Exception as _e:  # pragma: no cover
                    print(f"[analysis_persist] concordance save failed: {_e}")
                return result_payload
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"❌ Unexpected concordance error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------------------------------------------------------------------------
# Multi-node concordance endpoints (base.py lines ~2588-3013)
# ---------------------------------------------------------------------------
@router.get("/{workspace_id}/concordance/multi-node/current-request")
async def multi_node_concordance_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="multi_concordance")
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.request}


@router.get("/{workspace_id}/concordance/multi-node/current-result")
async def multi_node_concordance_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="multi_concordance")
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.result}


class MultiConcordanceResultQuery(BaseModel):
    node_id: Optional[str] = None
    combined: Optional[bool] = None
    page: Optional[int] = None
    page_size: Optional[int] = None
    sort_by: Optional[str] = None
    sort_order: Optional[str] = None


@router.post("/{workspace_id}/concordance/multi-node/current-result")
async def multi_node_concordance_current_result_post(
    workspace_id: str,
    query: MultiConcordanceResultQuery,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import get_latest_analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    rec = get_latest_analysis(user_id, workspace_id, task="multi_concordance")
    if not rec or not rec.request:
        return {
            "state": "failed",
            "message": "No analysis found for multi_concordance",
            "data": None,
        }
    try:
        base_req = rec.request
        node_ids = base_req.get("node_ids") or []
        node_columns = base_req.get("node_columns") or {}
        if not node_ids:
            return {
                "state": "failed",
                "message": "No prior request found for multi_concordance",
                "data": None,
            }
        page = query.page if query.page is not None else (base_req.get("page") or 1)
        page_size = (
            query.page_size
            if query.page_size is not None
            else (base_req.get("page_size") or 20)
        )
        sort_by = (
            query.sort_by if query.sort_by is not None else base_req.get("sort_by")
        )
        sort_order = (
            query.sort_order
            if query.sort_order is not None
            else (base_req.get("sort_order") or "asc")
        )
        combined = (
            bool(query.combined)
            if query.combined is not None
            else bool(base_req.get("combined") or False)
        )
        new_req = MultiNodeConcordanceRequest(
            node_ids=node_ids,
            node_columns=node_columns,
            search_word=base_req.get("search_word", ""),
            num_left_tokens=base_req.get("num_left_tokens", 10),
            num_right_tokens=base_req.get("num_right_tokens", 10),
            regex=bool(base_req.get("regex", False)),
            case_sensitive=bool(base_req.get("case_sensitive", False)),
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            sort_order=sort_order,
            combined=combined,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to prepare request: {e}")
    return await get_multi_node_concordance(workspace_id, new_req, current_user)


@router.post("/{workspace_id}/concordance/multi-node")
async def get_multi_node_concordance(
    workspace_id: str,
    request: MultiNodeConcordanceRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        if len(request.node_ids) == 0:
            raise HTTPException(
                status_code=400, detail="At least one node ID must be provided"
            )
        if len(request.node_ids) > 2:
            raise HTTPException(
                status_code=400, detail="Maximum 2 nodes supported for comparison"
            )
        results = {}
        full_dfs = []
        per_node_columns = {}
        for node_id in request.node_ids:
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
            column = request.node_columns.get(node_id)
            if not column:
                raise HTTPException(
                    status_code=400, detail=f"No column specified for node {node_id}"
                )
            if hasattr(node.data, "columns"):
                available_columns = node.data.columns
            elif hasattr(node.data, "schema"):
                available_columns = list(node.data.schema.keys())
            else:
                available_columns = []
            if available_columns and column not in available_columns:
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{column}' not found in node {node_id}. Available columns: {available_columns}",
                )
            cache_key = _concordance_cache_key(
                user_id,
                workspace_id,
                node_id,
                column,
                request.search_word,
                request.num_left_tokens,
                request.num_right_tokens,
                request.regex,
                request.case_sensitive,
            )
            concordance_result = _get_cached_concordance_df(cache_key)
            if concordance_result is None:
                if hasattr(node.data, "text"):
                    concordance_result = node.data.text.concordance(
                        column=column,
                        search_word=request.search_word,
                        num_left_tokens=request.num_left_tokens,
                        num_right_tokens=request.num_right_tokens,
                        regex=request.regex,
                        case_sensitive=request.case_sensitive,
                        explode=True,
                        unnest=True,
                    )
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Node {node_id} does not support text operations",
                    )
                _store_concordance_df(cache_key, concordance_result)
            working_df = concordance_result
            core_names = {
                "document_idx",
                "left_context",
                "matched_text",
                "right_context",
                "start_idx",
                "end_idx",
                "l1",
                "r1",
                "l1_freq",
                "r1_freq",
            }
            core_concordance_columns = [
                c for c in working_df.columns if c in core_names
            ]
            try:
                cdf = working_df
                if "document_idx" not in cdf.columns:
                    cdf = cdf.with_row_index("document_idx")
                has_metadata = any(
                    (col not in core_concordance_columns) and (col != "document_idx")
                    for col in cdf.columns
                )
                if not has_metadata:
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
                    cdf = cdf.join(orig, on="document_idx", how="left")
                working_df = cdf
            except Exception as je:
                logger.warning(
                    f"Failed to finalize concordance frame for node {node_id}: {je}"
                )
            all_columns = list(working_df.columns)
            metadata_columns = [
                col for col in all_columns if col not in core_concordance_columns
            ]
            working_df = working_df.filter(pl.col("matched_text").is_not_null())
            if (
                request.sort_by
                and hasattr(working_df, "columns")
                and request.sort_by in working_df.columns
            ):  # type: ignore
                working_df = working_df.sort(
                    pl.col(request.sort_by),
                    descending=request.sort_order.lower() == "desc",
                )  # type: ignore
            total_matches = len(working_df)
            start_idx = (request.page - 1) * request.page_size
            end_idx = start_idx + request.page_size
            paginated_result = working_df.slice(start_idx, request.page_size)
            node_name = node.name if hasattr(node, "name") and node.name else node_id
            per_node_columns[node_name] = list(working_df.columns)
            node_metadata = ConcordanceMetadata(
                concordance_columns=core_concordance_columns,
                metadata_columns=metadata_columns,
                all_columns=all_columns,
            )
            if hasattr(paginated_result, "to_dicts"):
                results[node_name] = {
                    "data": paginated_result.to_dicts(),
                    "columns": list(working_df.columns),
                    "metadata": node_metadata.model_dump(),
                    "total_matches": total_matches,
                    "pagination": {
                        "page": request.page,
                        "page_size": request.page_size,
                        "total_pages": (total_matches + request.page_size - 1)
                        // request.page_size,
                        "has_next": end_idx < total_matches,
                        "has_prev": request.page > 1,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
                if request.combined:
                    try:
                        df_with_source = working_df.with_columns(
                            pl.lit(node_name).alias("__source_node")
                        )  # type: ignore
                        full_dfs.append(df_with_source)
                    except Exception:
                        pass
            else:
                empty_metadata = ConcordanceMetadata(
                    concordance_columns=[], metadata_columns=[], all_columns=[]
                )
                results[node_name] = {
                    "data": [],
                    "columns": [],
                    "metadata": empty_metadata.model_dump(),
                    "total_matches": 0,
                    "pagination": {
                        "page": 1,
                        "page_size": request.page_size,
                        "total_pages": 0,
                        "has_next": False,
                        "has_prev": False,
                    },
                    "sorting": {
                        "sort_by": request.sort_by,
                        "sort_order": request.sort_order,
                    },
                }
        if request.combined and len(full_dfs) >= 2:
            try:
                col_sets = list(per_node_columns.values())
                if not col_sets or any(cols != col_sets[0] for cols in col_sets[1:]):
                    return {
                        "state": "successful",
                        "message": f"Found concordance results for search term '{request.search_word}'",
                        "data": results,
                    }
                combined_df = pl.concat(full_dfs, how="vertical")
                effective_sort_by = None
                effective_sort_order = (
                    request.sort_order if request.sort_order else "asc"
                )
                if request.sort_by and request.sort_by in combined_df.columns:
                    effective_sort_by = request.sort_by
                    combined_df = combined_df.sort(
                        pl.col(request.sort_by),
                        descending=effective_sort_order.lower() == "desc",
                    )
                elif "document_idx" in combined_df.columns:
                    effective_sort_by = "document_idx"
                    combined_df = combined_df.sort(pl.col("document_idx"))
                total_combined = len(combined_df)
                start_idx = (request.page - 1) * request.page_size
                paginated = combined_df.slice(start_idx, request.page_size)
                results["__COMBINED__"] = {
                    "data": paginated.to_dicts(),
                    "columns": list(combined_df.columns),
                    "total_matches": total_combined,
                    "pagination": {
                        "page": request.page,
                        "page_size": request.page_size,
                        "total_pages": (total_combined + request.page_size - 1)
                        // request.page_size,
                        "has_next": (start_idx + request.page_size) < total_combined,
                        "has_prev": request.page > 1,
                    },
                    "sorting": {
                        "sort_by": effective_sort_by,
                        "sort_order": effective_sort_order,
                    },
                }
            except Exception as ce:
                print(f"⚠️ Failed to build combined concordance view: {ce}")
        result_payload = {
            "state": "successful",
            "message": f"Found concordance results for search term '{request.search_word}'",
            "data": results,
        }
        try:  # pragma: no cover
            from ....core.analysis_store import save_analysis

            save_analysis(
                user_id=user_id,
                workspace_id=workspace_id,
                task="multi_concordance",
                request_dict=request.model_dump()
                if hasattr(request, "model_dump")
                else request.dict(),
                result_dict=result_payload,
            )
        except Exception as _e:  # pragma: no cover
            print(f"[analysis_persist] multi_concordance save failed: {_e}")
        return result_payload
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"❌ Unexpected multi-node concordance error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.post("/{workspace_id}/concordance/cache/clear")
async def clear_concordance_cache(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    from ....core.analysis_admin import clear_concordance_cache_for

    removed = clear_concordance_cache_for(user_id, workspace_id)
    return {"state": "successful", "removed": removed}


@router.post("/{workspace_id}/concordance/multi-node/clear")
async def clear_multi_concordance_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    try:
        from ....core.analysis_store import clear_analyses
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"analysis_store unavailable: {e}")
    removed = clear_analyses(user_id, workspace_id, task="multi_concordance")
    from ....core.analysis_admin import clear_concordance_cache_for

    cache_removed = clear_concordance_cache_for(user_id, workspace_id)
    return {
        "state": "successful",
        "cleared": {
            "analyses_removed": removed,
            "concordance_cache_removed": cache_removed,
        },
    }


# ---------------------------------------------------------------------------
# Concordance detail endpoint (base.py lines ~3100-3155)
# ---------------------------------------------------------------------------
@router.get("/{workspace_id}/nodes/{node_id}/concordance/{document_idx}")
async def get_concordance_detail(
    workspace_id: str,
    node_id: str,
    document_idx: int,
    text_column: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        data = node.data
        if hasattr(data, "collect"):
            data = data.collect()
        if document_idx < 0 or document_idx >= len(data):
            raise HTTPException(status_code=404, detail="Document index not found")
        record = data.slice(document_idx, 1).to_dicts()[0]
        full_text = record.get(text_column, "")
        metadata = {k: v for k, v in record.items() if k != text_column}
        available_columns = list(data.columns) if hasattr(data, "columns") else []
        return {
            "document_idx": document_idx,
            "text_column": text_column,
            "full_text": str(full_text),
            "metadata": metadata,
            "available_columns": available_columns,
            "record": record,
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback

        print(f"❌ Unexpected concordance detail error: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ---------------------------------------------------------------------------
# Concordance detach endpoint (base.py lines ~3432-3594)
# ---------------------------------------------------------------------------
@router.post("/{workspace_id}/nodes/{node_id}/concordance/detach")
async def detach_concordance(
    workspace_id: str,
    node_id: str,
    request: ConcordanceDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
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
        if hasattr(node.data, "text"):
            concordance_result = node.data.text.concordance(
                column=request.column,
                search_word=request.search_word,
                num_left_tokens=request.num_left_tokens,
                num_right_tokens=request.num_right_tokens,
                regex=request.regex,
                case_sensitive=request.case_sensitive,
                explode=True,
                unnest=True,
            )
            if "document_idx" not in concordance_result.columns:
                concordance_with_idx = concordance_result.with_row_index("document_idx")
            else:
                concordance_with_idx = concordance_result
            if isinstance(node.data, pl.LazyFrame):
                underlying_df = node.data.collect()
            elif hasattr(node.data, "to_lazyframe"):
                underlying_df = node.data.to_lazyframe().collect()  # type: ignore
            elif hasattr(node.data, "_df"):
                underlying_df = node.data._df  # type: ignore[attr-defined]
            else:
                underlying_df = node.data
            if isinstance(underlying_df, pl.LazyFrame):
                underlying_df = underlying_df.collect()
            if not isinstance(underlying_df, pl.DataFrame):
                raise HTTPException(
                    status_code=500,
                    detail="Failed to materialize underlying data for concordance detach",
                )
            original_with_idx = underlying_df.with_row_index("document_idx")
            other_df = concordance_with_idx.select([
                "document_idx",
                "left_context",
                "matched_text",
                "right_context",
                "l1",
                "r1",
                "l1_freq",
                "r1_freq",
            ])
            final_data = original_with_idx.join(
                other_df, on="document_idx", how="left"
            ).drop("document_idx")
            if request.new_node_name:
                new_node_name = request.new_node_name
            else:
                original_name = (
                    node.name if hasattr(node, "name") and node.name else node_id
                )
                new_node_name = f"{original_name}_conc_{request.search_word}"
            data_for_node = final_data
            try:  # pragma: no cover
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
                operation="concordance_detach",
                parents=[node],
            )
            if not new_node:
                raise HTTPException(
                    status_code=500, detail="Failed to create detached concordance node"
                )
            total_rows = final_data.height if hasattr(final_data, "height") else -1
            return {
                "success": True,
                "message": f"Successfully created detached concordance node '{new_node_name}' with {total_rows if total_rows >= 0 else 'unknown'} rows",
                "new_node_id": new_node.id,
                "new_node_name": new_node_name,
                "total_rows": total_rows,
                "concordance_matches": len(concordance_result),
            }
        else:
            raise HTTPException(
                status_code=400,
                detail="This node does not support text analysis (DocFrame text namespace not available)",
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error in detach concordance: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error detaching concordance results: {str(e)}"
        )
