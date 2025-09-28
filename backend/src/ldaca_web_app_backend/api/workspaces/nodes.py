"""Node operation endpoints extracted from base.py.

Maintains identical routes and behavior to preserve backward compatibility.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, Optional

import polars as pl
from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.auth import get_current_user
from ...core.docworkspace_api import DocWorkspaceAPIUtils
from ...core.workspace import workspace_manager
from ...models import FilterPreviewResponse, FilterRequest, SliceRequest
from .utils import _handle_operation_result

router = APIRouter(prefix="/workspaces", tags=["nodes"])

try:  # pragma: no cover
    from docframe import DocDataFrame, DocLazyFrame  # type: ignore
except Exception:  # pragma: no cover
    DocDataFrame = None  # type: ignore
    DocLazyFrame = None  # type: ignore


ISO_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+\-]\d{2}:?\d{2})$"
)


def _parse_temporal(value: Any) -> Any:
    if isinstance(value, str) and ISO_PATTERN.match(value):
        s = value
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        if re.search(r"([+\-]\d{2})(\d{2})$", s):
            s = re.sub(r"([+\-]\d{2})(\d{2})$", r"\1:\2", s)
        try:
            return datetime.fromisoformat(s)
        except Exception:
            return value
    return value


def _coerce_scalar(value: Any) -> Any:
    if isinstance(value, str):
        lowered = value.lower()
        if lowered in {"true", "false"}:
            return lowered == "true"
        try:
            if "." in value:
                return float(value)
            return int(value)
        except Exception:
            return value
    return value


def _build_filter_expression(request: FilterRequest) -> pl.Expr:
    logic = (request.logic or "and").lower()
    filter_expr = None

    for condition in request.conditions:
        column_expr = pl.col(condition.column)
        op = condition.operator
        raw_value = condition.value
        expr = None

        if op in {
            "eq",
            "equals",
            "ne",
            "gt",
            "greater_than",
            "gte",
            "lt",
            "less_than",
            "lte",
        }:
            value = _coerce_scalar(_parse_temporal(raw_value))
            lit_val = pl.lit(value) if isinstance(value, datetime) else value
            if op in {"eq", "equals"}:
                expr = column_expr == lit_val
            elif op == "ne":
                expr = column_expr != lit_val
            elif op in {"gt", "greater_than"}:
                expr = column_expr > lit_val
            elif op == "gte":
                expr = column_expr >= lit_val
            elif op in {"lt", "less_than"}:
                expr = column_expr < lit_val
            elif op == "lte":
                expr = column_expr <= lit_val
        elif op == "contains":
            pattern = str(raw_value)
            if getattr(condition, "regex", False):
                expr = column_expr.str.contains(pattern)
            else:
                expr = column_expr.str.contains(pl.lit(pattern), literal=True)
        elif op == "startswith":
            expr = column_expr.str.starts_with(str(raw_value))
        elif op == "endswith":
            expr = column_expr.str.ends_with(str(raw_value))
        elif op == "is_null":
            expr = column_expr.is_null()
        elif op == "is_not_null":
            expr = column_expr.is_not_null()
        elif op == "between":
            expr = pl.lit(True)
            if isinstance(raw_value, dict):
                start_val = (
                    _parse_temporal(raw_value.get("start"))
                    if raw_value.get("start") is not None
                    else None
                )
                end_val = (
                    _parse_temporal(raw_value.get("end"))
                    if raw_value.get("end") is not None
                    else None
                )
                if start_val is not None and end_val is not None:
                    if isinstance(start_val, datetime):
                        start_val = pl.lit(start_val)
                    if isinstance(end_val, datetime):
                        end_val = pl.lit(end_val)
                    expr = column_expr.is_between(start_val, end_val, closed="both")
                elif start_val is not None:
                    if isinstance(start_val, datetime):
                        start_val = pl.lit(start_val)
                    expr = column_expr >= start_val
                elif end_val is not None:
                    if isinstance(end_val, datetime):
                        end_val = pl.lit(end_val)
                    expr = column_expr <= end_val
        else:
            expr = column_expr.str.contains(str(raw_value))

        if getattr(condition, "negate", False) and expr is not None:
            try:
                expr = expr.not_()
            except Exception:
                expr = ~expr

        if expr is None:
            continue

        if filter_expr is None:
            filter_expr = expr
        else:
            filter_expr = (
                (filter_expr | expr) if logic == "or" else (filter_expr & expr)
            )

    if filter_expr is None:
        raise ValueError("No valid filter conditions provided")

    return filter_expr


def _ensure_lazyframe(data: Any) -> pl.LazyFrame:
    if isinstance(data, pl.LazyFrame):
        return data
    if isinstance(data, pl.DataFrame):
        return data.lazy()
    if hasattr(data, "lazy"):
        try:
            lazy_candidate = data.lazy()
            if isinstance(lazy_candidate, pl.LazyFrame):
                return lazy_candidate
        except Exception:
            pass
    if hasattr(data, "to_lazyframe"):
        try:
            lazy_candidate = data.to_lazyframe()
            if isinstance(lazy_candidate, pl.LazyFrame):
                return lazy_candidate
        except Exception:
            pass
    if hasattr(data, "to_docdataframe"):
        try:
            doc_df = data.to_docdataframe()
            base_df = getattr(doc_df, "dataframe", None)
            if isinstance(base_df, pl.DataFrame):
                return base_df.lazy()
        except Exception:
            pass
    if hasattr(data, "dataframe"):
        base_df = getattr(data, "dataframe")
        if isinstance(base_df, pl.DataFrame):
            return base_df.lazy()
    raise HTTPException(
        status_code=500, detail="Unsupported data type for filtering preview"
    )


@router.get("/{workspace_id}/nodes/{node_id}")
async def get_node_info(
    workspace_id: str, node_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        return DocWorkspaceAPIUtils.convert_node_info_for_api(node)
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to get node info: {e}")


@router.get("/{workspace_id}/nodes/{node_id}/data")
async def get_node_data(
    workspace_id: str,
    node_id: str,
    page: int = 1,
    page_size: int = 20,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        data_obj = node.data
        if hasattr(data_obj, "collect"):
            df = data_obj.collect()
        else:
            df = data_obj
        total_rows = len(df)
        start_idx = (page - 1) * page_size
        paginated_df = df.slice(start_idx, page_size)
        return {
            "data": paginated_df.to_dicts(),
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_rows": total_rows,
                "total_pages": (total_rows + page_size - 1) // page_size,
                "has_next": start_idx + page_size < total_rows,
                "has_prev": page > 1,
            },
            "columns": list(df.columns),
            "dtypes": {col: str(dtype) for col, dtype in df.schema.items()},
        }
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to get node data: {e}")


@router.get("/{workspace_id}/nodes/{node_id}/shape")
async def get_node_shape(
    workspace_id: str, node_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        data_obj = node.data
        try:  # pragma: no cover
            from docframe import DocDataFrame, DocLazyFrame  # type: ignore

            doc_wrapper = isinstance(data_obj, (DocDataFrame, DocLazyFrame))
        except Exception:  # pragma: no cover
            doc_wrapper = False
        if (
            node.is_lazy
            and hasattr(data_obj, "select")
            and hasattr(data_obj, "collect")
        ):
            try:
                count_df = data_obj.select(pl.len().alias("_len"))
                collected = count_df.collect()
                polars_df = (
                    collected.to_dataframe()
                    if hasattr(collected, "to_dataframe")
                    else collected
                )
                row_count = polars_df.to_series(0).item()
            except Exception:
                try:
                    full = data_obj.collect()
                    polars_full = (
                        full.to_dataframe() if hasattr(full, "to_dataframe") else full
                    )
                    row_count = (
                        polars_full.shape[0] if hasattr(polars_full, "shape") else None
                    )
                except Exception:
                    row_count = None
            try:
                if hasattr(data_obj, "collect_schema"):
                    schema = data_obj.collect_schema()
                    names = schema.names() if hasattr(schema, "names") else []
                    column_count = len(names)
                else:
                    minimal = data_obj.collect()
                    polars_min = (
                        minimal.to_dataframe()
                        if hasattr(minimal, "to_dataframe")
                        else minimal
                    )
                    column_count = (
                        polars_min.shape[1] if hasattr(polars_min, "shape") else None
                    )
            except Exception:
                column_count = None
            shape = [row_count, column_count]
        else:
            if hasattr(data_obj, "shape"):
                try:
                    shape_tuple = data_obj.shape
                    shape = [shape_tuple[0], shape_tuple[1]]
                except Exception:
                    shape = [None, None]
            else:
                shape = [None, None]
        return {
            "shape": shape,
            "is_lazy": node.is_lazy,
            "calculated": True,
            "doc_wrapper": doc_wrapper,
        }
    except Exception as e:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate node shape: {type(e).__name__}: {e}",
        )


@router.get("/{workspace_id}/nodes/{node_id}/columns/{column_name}/unique")
async def get_column_unique_values(
    workspace_id: str,
    node_id: str,
    column_name: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        data_obj = node.data
        if hasattr(data_obj, "columns"):
            columns = list(data_obj.columns)
        elif hasattr(data_obj, "schema"):
            columns = list(data_obj.schema.keys())
        else:
            raise HTTPException(status_code=400, detail="Cannot determine columns")
        if column_name not in columns:
            raise HTTPException(
                status_code=404, detail=f"Column '{column_name}' not found"
            )
        if hasattr(data_obj, "collect"):
            df = data_obj.collect()
        else:
            df = data_obj
        try:
            unique_values = df.select(column_name).unique().to_series().to_list()
            unique_count = len(unique_values)
            max_values_to_return = 100
            sample_values = unique_values[:max_values_to_return]
            return {
                "column_name": column_name,
                "unique_count": unique_count,
                "sample_values": sample_values,
                "total_values_returned": len(sample_values),
                "has_more": len(unique_values) > max_values_to_return,
            }
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to get unique values for column '{column_name}': {e}",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to process column unique values: {e}"
        )


@router.delete("/{workspace_id}/nodes/{node_id}")
async def delete_node(
    workspace_id: str, node_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    success = workspace_manager.delete_node_from_workspace(
        user_id, workspace_id, node_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Node not found")
    return {"state": "successful", "message": "Node deleted successfully"}


@router.post("/{workspace_id}/nodes/{node_id}/convert")
async def convert_node(
    workspace_id: str,
    node_id: str,
    target: str = Query(
        ...,
        description="Target type: docdataframe, dataframe, doclazyframe, or lazyframe",
    ),
    document_column: Optional[str] = Query(
        None,
        description="Document column for Doc* types (auto-detected if not specified)",
    ),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    valid_targets = {"docdataframe", "dataframe", "doclazyframe", "lazyframe"}
    if target not in valid_targets:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid target '{target}'. Must be one of: {', '.join(sorted(valid_targets))}",
        )
    if target in {"docdataframe", "doclazyframe"} and (
        DocDataFrame is None or DocLazyFrame is None
    ):
        raise HTTPException(
            status_code=500, detail="docframe library not available on backend"
        )
    src_node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not src_node:
        raise HTTPException(status_code=404, detail="Node not found")
    data = getattr(src_node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")
    try:
        new_data = None
        operation_name = f"convert_to_{target}"
        if target == "docdataframe":
            if isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                if document_column and document_column != data.document_column:
                    new_data = data.set_document(document_column)
                else:
                    new_data = data
            elif isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                collected = data.to_docdataframe()
                if document_column and document_column != collected.document_column:
                    new_data = collected.set_document(document_column)
                else:
                    new_data = collected
            elif isinstance(data, pl.DataFrame):
                doc_col = document_column or _guess_doc_column(data)
                if not doc_col:
                    raise HTTPException(
                        status_code=400,
                        detail="Unable to auto-detect a document column. Please specify document_column.",
                    )
                new_data = DocDataFrame(data, document_column=doc_col)  # type: ignore[call-arg]
            elif isinstance(data, pl.LazyFrame):
                doc_col = document_column or _guess_doc_column(data)
                if not doc_col:
                    raise HTTPException(
                        status_code=400,
                        detail="Unable to auto-detect a document column. Please specify document_column.",
                    )
                new_data = DocDataFrame(data.collect(), document_column=doc_col)  # type: ignore[call-arg]
        elif target == "dataframe":
            if DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                new_data = data.dataframe
            elif DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                new_data = data.to_docdataframe().dataframe
            elif hasattr(data, "collect"):
                new_data = data.collect()
            elif isinstance(data, pl.DataFrame):
                new_data = data
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported data type for conversion: {type(data).__name__}",
                )
        elif target == "doclazyframe":
            if isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                if document_column and document_column != data.document_column:
                    if document_column not in getattr(data, "columns", []):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Document column '{document_column}' not found in node.",
                        )
                    new_data = data.with_document_column(document_column)
                else:
                    new_data = data
            elif isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                lf = data.dataframe.lazy()
                doc_col = document_column or data.document_column
                if document_column and document_column not in data.dataframe.columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Document column '{document_column}' not found in node.",
                    )
                new_data = DocLazyFrame(lf, document_column=doc_col)  # type: ignore[misc]
            elif isinstance(data, pl.LazyFrame):
                doc_col = document_column or _guess_doc_column(data)
                if not doc_col:
                    raise HTTPException(
                        status_code=400,
                        detail="Unable to auto-detect a document column. Please specify document_column.",
                    )
                new_data = DocLazyFrame(data, document_column=doc_col)  # type: ignore[misc]
            elif isinstance(data, pl.DataFrame):
                lf = data.lazy()
                doc_col = document_column or _guess_doc_column(lf)
                if not doc_col:
                    raise HTTPException(
                        status_code=400,
                        detail="Unable to auto-detect a document column. Please specify document_column.",
                    )
                new_data = DocLazyFrame(lf, document_column=doc_col)  # type: ignore[misc]
        elif target == "lazyframe":
            if DocLazyFrame is not None and isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
                new_data = data.to_lazyframe()
            elif DocDataFrame is not None and isinstance(data, DocDataFrame):  # type: ignore[arg-type]
                new_data = data.dataframe.lazy()
            elif isinstance(data, pl.DataFrame):
                new_data = data.lazy()
            elif isinstance(data, pl.LazyFrame):
                new_data = data
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported data type for conversion: {type(data).__name__}",
                )
        if new_data is None:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported data type for conversion: {type(data).__name__}",
            )
        src_node.data = new_data  # type: ignore[assignment]
        try:
            src_node.operation += "\n" + operation_name
        except Exception:
            pass
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager.persist(user_id, workspace_id)
        return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Conversion failed: {e}")


def _guess_doc_column(data) -> Optional[str]:
    try:
        if DocDataFrame is not None and hasattr(DocDataFrame, "guess_document_column"):
            return DocDataFrame.guess_document_column(data)  # type: ignore[attr-defined]
    except Exception:
        pass
    candidates = ["document", "text", "content", "body", "message"]
    try:
        cols = (
            list(data.collect_schema().keys())
            if hasattr(data, "collect_schema")
            else list(getattr(data, "columns", []))
        )
        for c in candidates:
            if c in cols:
                return c
    except Exception:
        return None
    return None


@router.post("/{workspace_id}/nodes/{node_id}/reset-document")
async def reset_node_document_column(
    workspace_id: str,
    node_id: str,
    document_column: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    if DocDataFrame is None or DocLazyFrame is None:
        raise HTTPException(
            status_code=500, detail="docframe library not available on backend"
        )
    src_node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not src_node:
        raise HTTPException(status_code=404, detail="Node not found")
    data = getattr(src_node, "data", None)
    if data is None:
        raise HTTPException(status_code=400, detail="Node has no data")
    try:
        new_data = None
        if isinstance(data, DocDataFrame):  # type: ignore[arg-type]
            current_col = data.document_column  # type: ignore[attr-defined]
            target_col = document_column or _guess_doc_column(data.dataframe)
            if not target_col:
                raise HTTPException(
                    status_code=400,
                    detail="Unable to auto-detect document column; please provide document_column",
                )
            if target_col not in data.dataframe.columns:
                raise HTTPException(
                    status_code=400, detail=f"Document column '{target_col}' not found."
                )
            if target_col == current_col:
                return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)
            new_data = data.set_document(target_col)
        elif isinstance(data, DocLazyFrame):  # type: ignore[arg-type]
            current_col = data.document_column  # type: ignore[attr-defined]
            target_col = document_column or _guess_doc_column(data.lazyframe)
            if not target_col:
                raise HTTPException(
                    status_code=400,
                    detail="Unable to auto-detect document column; please provide document_column",
                )
            schema = data.lazyframe.collect_schema()
            if target_col not in schema:
                raise HTTPException(
                    status_code=400,
                    detail=f"Document column '{target_col}' not found in schema",
                )
            if schema[target_col] not in (pl.Utf8, pl.String):
                raise HTTPException(
                    status_code=400,
                    detail=f"Column '{target_col}' is not a string column",
                )
            if target_col == current_col:
                return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)
            new_data = DocLazyFrame(data.lazyframe, document_column=target_col)  # type: ignore[misc]
        else:
            raise HTTPException(
                status_code=400,
                detail="Reset document column only supported for DocDataFrame or DocLazyFrame nodes",
            )
        src_node.data = new_data  # type: ignore[assignment]
        try:
            src_node.operation = "reset_document"
        except Exception:
            pass
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            workspace_manager.persist(user_id, workspace_id)
        return DocWorkspaceAPIUtils.convert_node_info_for_api(src_node)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Reset document failed: {e}")


@router.put("/{workspace_id}/nodes/{node_id}/name")
async def update_node_name(
    workspace_id: str,
    node_id: str,
    new_name: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        node.name = new_name
        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if workspace is not None:
            try:
                workspace_manager.persist(user_id, workspace_id)
            except Exception:
                pass
        try:
            return DocWorkspaceAPIUtils.convert_node_info_for_api(node)  # type: ignore[call-arg]
        except Exception:
            return {"id": getattr(node, "id", node_id), "name": new_name}
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to rename node: {e}")


@router.post("/{workspace_id}/nodes/{node_id}/filter")
async def filter_node(
    workspace_id: str,
    node_id: str,
    request: FilterRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]

    def filter_operation():
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError("Node not found")
        filter_expr = _build_filter_expression(request)
        if hasattr(node.data, "filter"):
            filtered_data = node.data.filter(filter_expr)
        else:
            filtered_data = node.data.lazy().filter(filter_expr)
        new_node_name = request.new_node_name or f"{node.name}_filtered"
        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=filtered_data,
            node_name=new_node_name,
            operation=f"filter({node.name})",
            parents=[node],
        )
        return new_node

    result = workspace_manager.execute_safe_operation(
        user_id, workspace_id, filter_operation
    )
    success, message, result_obj = _handle_operation_result(result)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return result_obj


@router.post("/{workspace_id}/nodes/{node_id}/filter/preview")
async def filter_preview(
    workspace_id: str,
    node_id: str,
    request: FilterRequest,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
) -> FilterPreviewResponse:
    user_id = current_user["id"]
    node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    try:
        filter_expr = _build_filter_expression(request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        lazy_data = _ensure_lazyframe(node.data)
        filtered_lazy = lazy_data.filter(filter_expr)

        total_rows_series = (
            filtered_lazy.select(pl.len().alias("_len")).collect().to_series(0)
        )
        total_rows = int(total_rows_series.item()) if total_rows_series.len() else 0

        normalized_page_size = page_size
        total_pages = math.ceil(total_rows / normalized_page_size) if total_rows else 0
        normalized_page = min(max(page, 1), total_pages or 1)
        start_idx = (normalized_page - 1) * normalized_page_size if total_rows else 0

        preview_df = (
            filtered_lazy.slice(start_idx, normalized_page_size).collect()
            if total_rows
            else filtered_lazy.slice(0, normalized_page_size).collect()
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate filter preview: {exc}",
        ) from exc

    columns = list(preview_df.columns)
    dtypes = {col: str(dtype) for col, dtype in preview_df.schema.items()}
    data_rows = preview_df.to_dicts()

    return {
        "data": data_rows,
        "columns": columns,
        "dtypes": dtypes,
        "pagination": {
            "page": normalized_page,
            "page_size": normalized_page_size,
            "total_rows": total_rows,
            "total_pages": total_pages,
            "has_next": normalized_page < total_pages,
            "has_prev": normalized_page > 1 and total_rows > 0,
        },
    }


@router.post("/{workspace_id}/nodes/{node_id}/slice")
async def slice_node(
    workspace_id: str,
    node_id: str,
    request: SliceRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]

    def slice_operation():
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError("Node not found")
        sliced_data = node.data
        if request.start_row is not None or request.end_row is not None:
            start = request.start_row or 0
            length = None
            if request.end_row is not None:
                length = request.end_row - start
            if hasattr(sliced_data, "slice"):
                sliced_data = sliced_data.slice(start, length)
            else:
                sliced_data = sliced_data.lazy().slice(start, length)
        if request.columns:
            if hasattr(sliced_data, "select"):
                sliced_data = sliced_data.select(request.columns)
            else:
                sliced_data = sliced_data.lazy().select(request.columns)
        new_node_name = request.new_node_name or f"{node.name}_sliced"
        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=sliced_data,
            node_name=new_node_name,
            operation=f"slice({node.name})",
            parents=[node],
        )
        return new_node

    result = workspace_manager.execute_safe_operation(
        user_id, workspace_id, slice_operation
    )
    success, message, result_obj = _handle_operation_result(result)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return result_obj


@router.post("/{workspace_id}/nodes/join")
async def join_nodes(
    workspace_id: str,
    left_node_id: str,
    right_node_id: str,
    left_on: str,
    right_on: str,
    how: str = "inner",
    new_node_name: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        left_node = workspace_manager.get_node_from_workspace(
            user_id, workspace_id, left_node_id
        )
        right_node = workspace_manager.get_node_from_workspace(
            user_id, workspace_id, right_node_id
        )
        if not left_node or not right_node:
            raise HTTPException(status_code=404, detail="One or both nodes not found")
        left_data = left_node.data
        right_data = right_node.data
        allowed_hows = {"inner", "left", "right", "full", "semi", "anti", "cross"}
        how_val = (how or "inner").lower()
        if how_val not in allowed_hows:
            raise HTTPException(
                status_code=400,
                detail="Invalid join type. Allowed values: inner, left, right, full, semi, anti, cross",
            )
        if how_val == "cross":
            joined_data = left_data.join(right_data, how="cross")
        else:
            joined_data = left_data.join(
                right_data, left_on=left_on, right_on=right_on, how=how_val
            )
        node_name = new_node_name or f"{left_node.name}_join_{right_node.name}"
        new_node = workspace_manager.add_node_to_workspace(
            user_id=user_id,
            workspace_id=workspace_id,
            data=joined_data,
            node_name=node_name,
            operation=f"join({left_node.name}, {right_node.name})",
            parents=[left_node, right_node],
        )
        return DocWorkspaceAPIUtils.convert_node_info_for_api(new_node)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Join failed: {e}")
