"""Node operation endpoints extracted from base.py.

Maintains identical routes and behavior to preserve backward compatibility.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any, List, Optional

import polars as pl
from docworkspace import Node
from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.auth import get_current_user
from ...core.expression_parser import ExpressionParseError, build_polars_expression
from ...core.workspace import workspace_manager
from ...models import (
    ConcatPreviewRequest,
    ConcatRequest,
    ExpressionApplyResponse,
    ExpressionPreviewResponse,
    ExpressionTransformRequest,
    FilterPreviewResponse,
    FilterRequest,
    SliceRequest,
)
from .utils import update_workspace

router = APIRouter(prefix="/workspaces", tags=["nodes"])


ISO_PATTERN = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+\-]\d{2}:?\d{2})$"
)


def _parse_temporal(value: Any) -> Any:
    """Parse ISO-like datetime strings into `datetime` objects when possible.

    Used by:
    - `_build_filter_expression`

    Why:
    - Enables temporal comparisons in filter operators.
    """
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
    """Coerce string scalars into bool/int/float when safe.

    Used by:
    - `_build_filter_expression`

    Why:
    - Keeps query payload values aligned with Polars expression expectations.
    """
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


def _sanitize_column_alias(label: str) -> str:
    sanitized = re.sub(r"\s+", " ", label or "").strip()
    if not sanitized:
        return "computed_column"
    return sanitized[:120]


def _resolve_expression_column_name(request: ExpressionTransformRequest) -> str:
    """Resolve final computed-column name from request expression metadata.

    Used by:
    - `compute_column_preview`
    - `compute_column_apply`

    Why:
    - Keeps naming rules consistent between preview and apply endpoints.
    """
    candidate = (request.new_column_name or request.expression or "").strip()
    return _sanitize_column_alias(candidate)


def _is_string_list_dtype(dtype: Any) -> bool:
    """Return True when dtype is exactly a list of strings."""
    return dtype == pl.List(pl.String) or dtype == pl.List(pl.Utf8)


def _build_filter_expression(
    request: FilterRequest,
    column_dtypes: Optional[dict[str, Any]] = None,
) -> pl.Expr:
    logic = (request.logic or "and").lower()
    filter_expr = None
    schema_map = column_dtypes or {}

    for condition in request.conditions:
        column_expr = pl.col(condition.column)
        column_dtype = schema_map.get(condition.column)
        is_string_list_column = _is_string_list_dtype(column_dtype)
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
        elif op == "in":
            include_null = False
            values: list[Any] = []

            if isinstance(raw_value, (list, tuple, set)):
                for item in raw_value:
                    if item is None:
                        include_null = True
                        continue
                    values.append(_coerce_scalar(_parse_temporal(item)))
            elif raw_value is None:
                include_null = True
            else:
                values = [_coerce_scalar(_parse_temporal(raw_value))]

            if is_string_list_column:
                string_values = [str(item) for item in values if item is not None]
                if string_values:
                    expr = column_expr.list.eval(
                        pl.element().cast(pl.String).is_in(string_values),
                        parallel=False,
                    ).list.any()
                else:
                    expr = pl.lit(False)
            else:
                if values:
                    expr = column_expr.is_in(values)
                    if include_null:
                        expr = expr | column_expr.is_null()
                elif include_null:
                    expr = column_expr.is_null()
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


def _unwrap_lazyframe(data: Any, *, purpose: str) -> pl.LazyFrame:
    if isinstance(data, pl.LazyFrame):
        return data
    raise HTTPException(
        status_code=500,
        detail=f"{purpose} requires lazy node data but received {type(data).__name__}",
    )


def _get_node_display_name(node: Any) -> str:
    name = getattr(node, "name", None)
    if name:
        return str(name)
    for attr in ("node_id", "id", "pk", "uuid"):
        value = getattr(node, attr, None)
        if value is not None:
            return str(value)
    return "node"


def _get_concat_nodes(user_id: str, node_ids: List[str]) -> List[Any]:
    if not node_ids:
        raise HTTPException(
            status_code=400, detail="At least two node IDs are required"
        )
    ws = workspace_manager.get_current_workspace(user_id)
    nodes: List[Any] = []
    seen: set[str] = set()
    for raw_node_id in node_ids:
        node_id = raw_node_id.strip()
        if not node_id:
            continue
        if node_id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate node id '{node_id}' provided",
            )
        node = ws.nodes[node_id]
        nodes.append(node)
        seen.add(node_id)
    if len(nodes) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least two distinct nodes are required for concatenation",
        )
    return nodes


def _extract_lazy_schema(
    lazy_frame: pl.LazyFrame,
) -> tuple[List[str], dict[str, str]]:
    schema_dict = dict(lazy_frame.collect_schema().items())
    columns = list(schema_dict.keys())
    dtypes = {col: str(dtype) for col, dtype in schema_dict.items()}
    return columns, dtypes


def _validate_and_align_concat_nodes(
    nodes: List[Any],
) -> tuple[List[pl.LazyFrame], List[str], dict[str, str]]:
    lazy_frames: List[pl.LazyFrame] = [
        _unwrap_lazyframe(node.data, purpose="Concat requires lazy nodes")
        for node in nodes
    ]
    base_columns, base_dtypes = _extract_lazy_schema(lazy_frames[0])
    if not base_columns:
        raise HTTPException(
            status_code=400,
            detail="Unable to determine schema for the first node.",
        )

    select_expr = [pl.col(column) for column in base_columns]
    aligned_frames: List[pl.LazyFrame] = [lazy_frames[0].select(select_expr)]

    for node, lazy_frame in zip(nodes[1:], lazy_frames[1:]):
        columns, dtypes = _extract_lazy_schema(lazy_frame)
        missing = [col for col in base_columns if col not in columns]
        extra = [col for col in columns if col not in base_columns]
        mismatched = [
            col
            for col in base_columns
            if col in dtypes and base_dtypes.get(col) != dtypes.get(col)
        ]

        if missing or extra or mismatched:
            detail_parts: List[str] = []
            if missing:
                detail_parts.append("missing columns: " + ", ".join(sorted(missing)))
            if extra:
                detail_parts.append("unexpected columns: " + ", ".join(sorted(extra)))
            if mismatched:
                mismatch_details = ", ".join(
                    f"{col} ({base_dtypes.get(col)} vs {dtypes.get(col)})"
                    for col in sorted(mismatched)
                )
                detail_parts.append(f"type mismatches: {mismatch_details}")
            detail = (
                "Schema mismatch for node '"
                + _get_node_display_name(node)
                + "': "
                + "; ".join(detail_parts)
            )
            raise HTTPException(status_code=400, detail=detail)

        aligned_frames.append(lazy_frame.select(select_expr))

    return aligned_frames, base_columns, base_dtypes


def _calculate_concat_row_count(
    aligned_frames: List[pl.LazyFrame],
) -> Optional[int]:
    total = 0
    for lazy_frame in aligned_frames:
        try:
            count_df = lazy_frame.select(pl.len().alias("_len")).collect()
            total += int(count_df.to_series(0).item())
        except Exception:
            return None
    return total


def _derive_concat_node_name(nodes: List[Any], desired_name: Optional[str]) -> str:
    if desired_name:
        return desired_name
    labels = [_get_node_display_name(node) for node in nodes]
    if not labels:
        return "Stack Result"
    if len(labels) <= 3:
        label_str = ", ".join(labels)
    else:
        label_str = ", ".join(labels[:3]) + ", ..."
    return f"Stack({label_str})"


@router.post(
    "/nodes/{node_id}/compute-column/preview",
    response_model=ExpressionPreviewResponse,
)
async def compute_column_preview(
    node_id: str,
    request: ExpressionTransformRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    data_obj = workspace_manager.get_current_workspace(user_id).nodes[node_id].data

    try:
        lazy_data = _unwrap_lazyframe(data_obj, purpose="Compute column preview")
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=500, detail=f"Failed to inspect node data: {exc}"
        ) from exc

    columns, _ = _extract_lazy_schema(lazy_data)

    try:
        expr = build_polars_expression(request.expression, columns=columns)
    except ExpressionParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    column_name = _resolve_expression_column_name(request)
    expr = expr.cast(pl.Utf8, strict=False).alias(column_name)

    preview_limit = request.preview_limit or 50
    preview_limit = max(1, min(preview_limit, 500))

    try:
        preview_df = lazy_data.with_columns(expr).limit(preview_limit).collect()
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to evaluate expression: {exc}",
        ) from exc

    columns_out = list(preview_df.columns)
    dtypes_out = {col: str(dtype) for col, dtype in preview_df.schema.items()}
    data_rows = preview_df.to_dicts()

    return ExpressionPreviewResponse(
        columns=columns_out, dtypes=dtypes_out, data=data_rows
    )


@router.post(
    "/nodes/{node_id}/compute-column",
    response_model=ExpressionApplyResponse,
)
async def compute_column_apply(
    node_id: str,
    request: ExpressionTransformRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    node = ws.nodes[node_id]
    data_obj = node.data
    try:
        lazy_data = _unwrap_lazyframe(data_obj, purpose="Compute column apply")
        columns, _ = _extract_lazy_schema(lazy_data)
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=500,
            detail=f"Failed to inspect node schema: {exc}",
        ) from exc

    column_name = _resolve_expression_column_name(request)

    try:
        expr = (
            build_polars_expression(request.expression, columns=columns)
            .cast(pl.Utf8, strict=False)
            .alias(column_name)
        )
    except ExpressionParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        updated_data = lazy_data.with_columns(expr)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to evaluate expression: {exc}",
        ) from exc

    dtype_str: Optional[str] = None
    try:
        schema_dict = dict(updated_data.collect_schema().items())
        dtype = schema_dict.get(column_name)
        if dtype is not None:
            dtype_str = str(dtype)
    except Exception:  # pragma: no cover - best effort only
        dtype_str = None

    try:
        node.data = updated_data
        update_workspace(user_id, workspace_id)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist computed column: {exc}",
        ) from exc

    return ExpressionApplyResponse(
        state="successful",
        node_id=node_id,
        column_name=column_name,
        expression=request.expression.strip(),
        dtype=dtype_str,
        message=f"Added column '{column_name}' to node",
    )


@router.get("/nodes/{node_id}")
async def get_node_info(
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    ws = workspace_manager.get_current_workspace(user_id)
    node = ws.nodes[node_id]
    try:
        return node.info()
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to get node info: {e}")


@router.get("/nodes/{node_id}/data")
async def get_node_data(
    node_id: str,
    page: int = 1,
    page_size: int = 20,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    ws = workspace_manager.get_current_workspace(user_id)
    node = ws.nodes[node_id]
    data_obj = node.data
    try:
        lazyframe = _unwrap_lazyframe(data_obj, purpose="Get node data")
        df = lazyframe.collect()
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


@router.get("/nodes/{node_id}/shape")
async def get_node_shape(
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    ws = workspace_manager.get_current_workspace(user_id)
    node = ws.nodes[node_id]
    try:
        return {"shape": node.shape}
    except Exception as e:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate node shape: {type(e).__name__}: {e}",
        )


@router.get("/nodes/{node_id}/columns/{column_name}/unique")
async def get_column_unique_values(
    node_id: str,
    column_name: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    ws = workspace_manager.get_current_workspace(user_id)
    node = ws.nodes[node_id]
    data_obj = node.data
    try:
        lazyframe = _unwrap_lazyframe(data_obj, purpose="Get unique column values")
        schema = lazyframe.collect_schema()
        columns = list(schema.names())
        schema_map: dict[str, Any] = dict(schema.items())
        if column_name not in columns:
            raise HTTPException(
                status_code=404, detail=f"Column '{column_name}' not found"
            )
        try:
            if _is_string_list_dtype(schema_map.get(column_name)):
                unique_df = (
                    lazyframe
                    .select(pl.col(column_name).explode().alias(column_name))
                    .unique(maintain_order=True)
                    .collect()
                )
                raw_values = unique_df.get_column(column_name).to_list()
                has_null = any(value is None for value in raw_values)

                deduped_values = [
                    str(value) for value in raw_values if value is not None
                ]

                unique_count = len(deduped_values) + (1 if has_null else 0)
                return {
                    "column_name": column_name,
                    "unique_count": unique_count,
                    "unique_values": deduped_values,
                    "has_null": has_null,
                }

            unique_df = (
                lazyframe
                .select(pl.col(column_name).alias(column_name))
                .unique(maintain_order=True)
                .collect()
            )
            raw_values = unique_df.get_column(column_name).to_list()
            has_null = any(value is None for value in raw_values)
            non_null_values = [value for value in raw_values if value is not None]
            return {
                "column_name": column_name,
                "unique_count": len(raw_values),
                "unique_values": non_null_values,
                "has_null": has_null,
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


@router.get("/nodes/{node_id}/columns/{column_name}/describe")
async def describe_column(
    node_id: str,
    column_name: str,
    current_user: dict = Depends(get_current_user),
):
    """Get descriptive statistics for a column using Polars describe with 'nearest' interpolation."""
    from ...models import ColumnDescribeResponse

    user_id = current_user["id"]
    ws = workspace_manager.get_current_workspace(user_id)
    node = ws.nodes[node_id]
    data_obj = node.data

    try:
        lazyframe = _unwrap_lazyframe(data_obj, purpose="Describe column")
        columns = list(lazyframe.collect_schema().names())

        if column_name not in columns:
            raise HTTPException(
                status_code=404, detail=f"Column '{column_name}' not found"
            )

        df = lazyframe.collect()

        # Check if column is datetime type
        import polars as pl

        column_dtype = df.schema[column_name]
        is_datetime_column = column_dtype in (
            pl.Datetime,
            pl.Datetime("ms"),
            pl.Datetime("us"),
            pl.Datetime("ns"),
        )

        # Run describe with 'nearest' interpolation for percentiles
        # This works for both numeric and datetime columns
        try:
            desc_df = df.select(column_name).describe(interpolation="nearest")

            # Convert to dict for easier access
            desc_dict = {}
            for row in desc_df.iter_rows(named=True):
                stat_name = row.get("statistic") or row.get("describe")
                if stat_name:
                    desc_dict[stat_name] = row[column_name]

            # Helper function to serialize values
            def serialize_value(val):
                if val is None:
                    return None
                if isinstance(val, datetime):
                    return val.isoformat()
                # For datetime columns, convert string output from describe() to datetime
                if is_datetime_column and isinstance(val, str) and val != "null":
                    try:
                        # Parse datetime string from Polars describe output
                        # Format: "2023-01-01 10:00:00" or "2023-01-01 10:00:00+00:00"
                        dt = datetime.fromisoformat(val.replace(" ", "T"))
                        # Add UTC timezone if not present (Polars datetimes are typically UTC)
                        if dt.tzinfo is None:
                            from datetime import timezone

                            dt = dt.replace(tzinfo=timezone.utc)
                        return dt.isoformat()
                    except ValueError, AttributeError:
                        return val
                # For numeric columns, convert to float
                try:
                    return float(val)
                except TypeError, ValueError:
                    return val

            response = ColumnDescribeResponse(
                column_name=column_name,
                count=int(desc_dict.get("count", 0))
                if desc_dict.get("count") is not None
                else None,
                null_count=int(desc_dict.get("null_count", 0))
                if desc_dict.get("null_count") is not None
                else None,
                mean=serialize_value(desc_dict.get("mean")),
                std=serialize_value(desc_dict.get("std")),
                min=serialize_value(desc_dict.get("min")),
                percentile_25=serialize_value(desc_dict.get("25%")),
                median=serialize_value(desc_dict.get("50%")),
                percentile_75=serialize_value(desc_dict.get("75%")),
                max=serialize_value(desc_dict.get("max")),
            )

            return response

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to describe column '{column_name}': {e}",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to process column describe: {e}"
        )


@router.delete("/nodes/{node_id}")
async def delete_node(node_id: str, current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    workspace = workspace_manager.get_current_workspace(user_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    success = workspace.remove_node(node_id)
    if success:
        update_workspace(user_id, workspace_id)
    if not success:
        raise HTTPException(status_code=404, detail="Node not found")
    return {"state": "successful", "message": "Node deleted successfully"}


@router.put("/nodes/{node_id}/name")
async def update_node_name(
    node_id: str,
    new_name: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    node = workspace_manager.get_current_workspace(user_id).nodes[node_id]
    try:
        node.name = new_name
        update_workspace(user_id, workspace_id, best_effort=True)
        try:
            return node.info()
        except Exception:
            return {"id": getattr(node, "id", node_id), "name": new_name}
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to rename node: {e}")


@router.post("/nodes/{node_id}/clone")
async def clone_node(
    node_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    node = workspace_manager.get_current_workspace(user_id).nodes[node_id]
    workspace = workspace_manager.get_current_workspace(user_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    def _unique_clone_name(original: str) -> str:
        base = original or node_id
        candidate = f"{base}_clone"
        existing = {getattr(n, "name", None) for n in workspace.nodes.values()}
        if candidate not in existing:
            return candidate
        suffix = 2
        while f"{base}_clone_{suffix}" in existing:
            suffix += 1
        return f"{base}_clone_{suffix}"

    try:
        source_lazy = _unwrap_lazyframe(node.data, purpose="Clone node")
        cloned_lazy = source_lazy.clone()
        new_name = _unique_clone_name(getattr(node, "name", node_id))
        new_node = Node(
            data=cloned_lazy,
            name=new_name,
            workspace=workspace,
            operation=f"clone({getattr(node, 'name', node_id)})",
            parents=[node],
        )
        workspace.add_node(new_node)
        update_workspace(user_id, workspace_id)
        try:
            return new_node.info()
        except Exception:
            return {"id": getattr(new_node, "id", None), "name": new_name}
    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to clone node: {e}")


@router.post("/nodes/{node_id}/filter")
async def filter_node(
    node_id: str,
    request: FilterRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    node = workspace_manager.get_current_workspace(user_id).nodes[node_id]
    data_obj = node.data
    lazy_data = _unwrap_lazyframe(data_obj, purpose="Filter node")
    schema_map: dict[str, Any] = dict(lazy_data.collect_schema().items())
    filter_expr = _build_filter_expression(request, column_dtypes=schema_map)
    filtered_data = lazy_data.filter(filter_expr)
    new_node_name = request.new_node_name or f"{node.name}_filtered"
    workspace = workspace_manager.get_current_workspace(user_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    new_node = Node(
        data=filtered_data,
        name=new_node_name,
        workspace=workspace,
        operation=f"filter({node.name})",
        parents=[node],
    )
    workspace.add_node(new_node)
    update_workspace(user_id, workspace_id)
    return {
        "node_name": new_node.name,
        "node_id": new_node.id,
    }


@router.post("/nodes/{node_id}/filter/preview")
async def filter_preview(
    node_id: str,
    request: FilterRequest,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
) -> FilterPreviewResponse:
    user_id = current_user["id"]
    data_obj = workspace_manager.get_current_workspace(user_id).nodes[node_id].data
    lazy_data = _unwrap_lazyframe(data_obj, purpose="Filter preview")

    try:
        schema_map: dict[str, Any] = dict(lazy_data.collect_schema().items())
        filter_expr = _build_filter_expression(request, column_dtypes=schema_map)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
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


@router.post("/nodes/{node_id}/slice")
async def slice_node(
    node_id: str,
    request: SliceRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    node = workspace_manager.get_current_workspace(user_id).nodes[node_id]
    data_obj = node.data
    lazy_data = _unwrap_lazyframe(data_obj, purpose="Slice node")
    offset = int(request.offset or 0)
    length = request.length
    sliced_data = lazy_data.slice(offset, length)
    new_node_name = request.new_node_name or f"{node.name}_sliced"
    slice_args = f"offset={offset}"
    if length is not None:
        slice_args = f"{slice_args}, length={length}"
    workspace = workspace_manager.get_current_workspace(user_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    new_node = Node(
        data=sliced_data,
        name=new_node_name,
        workspace=workspace,
        operation=f"slice({node.name}, {slice_args})",
        parents=[node],
    )
    workspace.add_node(new_node)
    update_workspace(user_id, workspace_id)
    return {
        "node_name": new_node.name,
        "node_id": new_node.id,
    }


@router.post("/nodes/{node_id}/slice/preview")
async def slice_preview(
    node_id: str,
    request: SliceRequest,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
) -> FilterPreviewResponse:
    user_id = current_user["id"]
    data_obj = workspace_manager.get_current_workspace(user_id).nodes[node_id].data

    offset = int(request.offset or 0)
    length = request.length if request.length is None else int(request.length)

    try:
        lazy_data = _unwrap_lazyframe(data_obj, purpose="Slice preview")
        sliced_lazy = lazy_data.slice(offset, length)

        total_rows_series = (
            sliced_lazy.select(pl.len().alias("_len")).collect().to_series(0)
        )
        total_rows = int(total_rows_series.item()) if total_rows_series.len() else 0

        normalized_page_size = page_size
        total_pages = math.ceil(total_rows / normalized_page_size) if total_rows else 0
        normalized_page = min(max(page, 1), total_pages or 1)
        preview_offset = (
            (normalized_page - 1) * normalized_page_size if total_rows else 0
        )

        preview_df = sliced_lazy.slice(preview_offset, normalized_page_size).collect()
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate slice preview: {exc}",
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
            "has_next": preview_offset + normalized_page_size < total_rows,
            "has_prev": normalized_page > 1 and total_rows > 0,
        },
    }


@router.post("/nodes/concat/preview")
async def concat_nodes_preview(
    request: ConcatPreviewRequest,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        nodes = _get_concat_nodes(user_id, request.node_ids)
        aligned_frames, columns, dtypes = _validate_and_align_concat_nodes(nodes)
        concat_lazy = pl.concat(aligned_frames, how="vertical")
        total_rows = _calculate_concat_row_count(aligned_frames)

        normalized_page_size = page_size
        if total_rows is not None:
            total_pages = (
                math.ceil(total_rows / normalized_page_size) if total_rows else 0
            )
            normalized_page = min(max(page, 1), total_pages or 1)
            offset = (normalized_page - 1) * normalized_page_size if total_rows else 0
        else:
            total_pages = None
            normalized_page = max(page, 1)
            offset = (normalized_page - 1) * normalized_page_size

        preview_df = concat_lazy.slice(offset, normalized_page_size).collect()
        data_rows = preview_df.to_dicts()

        if total_rows is None:
            has_next = len(data_rows) == normalized_page_size
            inferred_total = (
                offset + len(data_rows) + (normalized_page_size if has_next else 0)
            )
            total_rows_value = inferred_total
            total_pages_value = max(1, normalized_page + (1 if has_next else 0))
        else:
            has_next = offset + normalized_page_size < total_rows
            total_rows_value = total_rows
            total_pages_value = total_pages

        pagination = {
            "page": normalized_page,
            "page_size": normalized_page_size,
            "total_rows": total_rows_value,
            "total_pages": total_pages_value,
            "has_next": has_next,
            "has_prev": normalized_page > 1 and (total_rows is None or total_rows > 0),
        }

        return {
            "data": data_rows,
            "columns": columns,
            "dtypes": dtypes,
            "pagination": pagination,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Concat preview failed: {exc}"
        ) from exc


@router.post("/nodes/concat")
async def concat_nodes(
    request: ConcatRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    try:
        nodes = _get_concat_nodes(user_id, request.node_ids)
        aligned_frames, _, _ = _validate_and_align_concat_nodes(nodes)
        concat_lazy = pl.concat(aligned_frames, how="vertical")
        node_name = _derive_concat_node_name(nodes, request.new_node_name)
        labels = [_get_node_display_name(node) for node in nodes]
        if len(labels) > 3:
            operation_args = ", ".join(labels[:3]) + ", ..."
        else:
            operation_args = ", ".join(labels)
        operation_label = f"concat({operation_args})"
        workspace = workspace_manager.get_current_workspace(user_id)
        if workspace is None:
            raise HTTPException(status_code=404, detail="Workspace not found")
        new_node = Node(
            data=concat_lazy,
            name=node_name,
            workspace=workspace,
            operation=operation_label,
            parents=nodes,
        )
        workspace.add_node(new_node)
        update_workspace(user_id, workspace_id)
        return new_node.info()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Concat failed: {exc}")


@router.post("/nodes/join/preview")
async def join_nodes_preview(
    left_node_id: str,
    right_node_id: str,
    left_on: Optional[str] = None,
    right_on: Optional[str] = None,
    how: str = "inner",
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    try:
        workspace = workspace_manager.get_current_workspace(user_id)
        left_node = workspace.nodes[left_node_id]
        right_node = workspace.nodes[right_node_id]

        allowed_hows = {"inner", "left", "right", "full", "semi", "anti", "cross"}
        how_val = (how or "inner").lower()
        if how_val not in allowed_hows:
            raise HTTPException(
                status_code=400,
                detail="Invalid join type. Allowed values: inner, left, right, full, semi, anti, cross",
            )

        left_lazy = _unwrap_lazyframe(
            left_node.data, purpose="Join preview requires lazy left node"
        )
        right_lazy = _unwrap_lazyframe(
            right_node.data, purpose="Join preview requires lazy right node"
        )

        if how_val == "cross":
            joined_lazy = left_lazy.join(right_lazy, how="cross")
        else:
            if not left_on or not right_on:
                raise HTTPException(
                    status_code=400,
                    detail="left_on and right_on must be provided for non-cross joins",
                )
            joined_lazy = left_lazy.join(
                right_lazy, left_on=left_on, right_on=right_on, how=how_val
            )

        try:
            total_rows_series = (
                joined_lazy.select(pl.len().alias("_len")).collect().to_series(0)
            )
            total_rows = int(total_rows_series.item())
        except Exception:
            total_rows = None

        offset = (page - 1) * page_size
        try:
            preview_df = joined_lazy.slice(offset, page_size).collect()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Join preview failed: {exc}")

        preview_rows = preview_df.to_dicts()
        preview_columns = list(preview_df.columns)
        dtypes = {col: str(dtype) for col, dtype in preview_df.schema.items()}

        if total_rows is None:
            has_next = len(preview_rows) == page_size
            inferred_total = offset + len(preview_rows) + (page_size if has_next else 0)
            total_rows_value = inferred_total
            total_pages = max(1, page + (1 if has_next else 0))
        else:
            has_next = offset + page_size < total_rows
            total_rows_value = total_rows
            total_pages = max(1, math.ceil(total_rows / page_size))

        return {
            "data": preview_rows,
            "columns": preview_columns,
            "dtypes": dtypes,
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_rows": total_rows_value,
                "total_pages": total_pages,
                "has_next": has_next,
                "has_prev": page > 1,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Join preview failed: {e}")


@router.post("/nodes/join")
async def join_nodes(
    left_node_id: str,
    right_node_id: str,
    left_on: str,
    right_on: str,
    how: str = "inner",
    new_node_name: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    try:
        workspace = workspace_manager.get_current_workspace(user_id)
        left_node = workspace.nodes[left_node_id]
        right_node = workspace.nodes[right_node_id]
        left_data = _unwrap_lazyframe(
            left_node.data, purpose="Join requires lazy left node"
        )
        right_data = _unwrap_lazyframe(
            right_node.data, purpose="Join requires lazy right node"
        )
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
        workspace = workspace_manager.get_current_workspace(user_id)
        new_node = Node(
            data=joined_data,
            name=node_name,
            workspace=workspace,
            operation=f"join({left_node.name}, {right_node.name})",
            parents=[left_node, right_node],
        )
        workspace.add_node(new_node)
        update_workspace(user_id, workspace_id)
        return new_node.info()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Join failed: {e}")
