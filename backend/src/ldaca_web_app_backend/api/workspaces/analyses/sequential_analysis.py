"""Sequential Analysis endpoints extracted from monolithic base module.

Exposes updated paths:
    POST /workspaces/{workspace_id}/nodes/{node_id}/sequential-analysis
    POST /workspaces/{workspace_id}/sequential-analysis/tasks/{task_id}/result
"""

from __future__ import annotations

import logging
from typing import Optional

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.sequential_analysis import (
    SequentialAnalysisRequest as AnalysisSequentialAnalysisRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import SequentialAnalysisRequest
from ..utils import ensure_task_synced
from .current_tasks import get_current_task_ids_for_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces")


VALID_CHART_TYPES = {"line", "bar", "area"}
DEFAULT_CHART_TYPE = "line"
SEQUENTIAL_TASK = "sequential_analysis"


# ---------------------------------------------------------------------------
# Standalone sequential-analysis logic (ported from docframe)
# ---------------------------------------------------------------------------


def _run_sequential_analysis(
    lf: pl.LazyFrame,
    *,
    time_column: str,
    group_by_columns: list[str] | None = None,
    frequency: str = "monthly",
    sort_by_time: bool = True,
    column_type: str = "datetime",
    numeric_origin: float | None = None,
    numeric_interval: float | None = None,
) -> pl.DataFrame:
    """Pure-Polars implementation of sequential analysis.

    Used by:
    - `run_sequential_analysis`

    Why:
    - Keeps binning/grouping logic independent from route orchestration.

    Groups records by time period (datetime truncation or numeric binning),
    counts occurrences per group, and returns a DataFrame with aggregated
    results.  No text-processing dependency required.
    """

    normalized_column_type = (column_type or "datetime").lower()
    if normalized_column_type not in {"datetime", "numeric"}:
        raise ValueError(
            "Unsupported column_type. Use 'datetime' or 'numeric' for sequential analysis"
        )

    # Collect to DataFrame for aggregation
    df = lf.collect()

    time_format = ""
    numeric_interval_value: float | None = None
    numeric_origin_value: float | None = None

    if normalized_column_type == "datetime":
        if frequency == "hourly":
            time_expr = pl.col(time_column).dt.truncate("1h").alias("time_period")
            time_format = "%Y-%m-%d %H:%M"
        elif frequency == "daily":
            time_expr = pl.col(time_column).dt.date().alias("time_period")
            time_format = "%Y-%m-%d"
        elif frequency == "weekly":
            time_expr = (
                pl.col(time_column).dt.truncate("1w").dt.date().alias("time_period")
            )
            time_format = "%Y-W%U"
        elif frequency == "monthly":
            time_expr = (
                pl.col(time_column).dt.truncate("1mo").dt.date().alias("time_period")
            )
            time_format = "%Y-%m"
        elif frequency == "quarterly":
            time_expr = (
                pl.col(time_column).dt.truncate("3mo").dt.date().alias("time_period")
            )
            time_format = "%Y-Q"
        elif frequency == "yearly":
            time_expr = (
                pl.col(time_column).dt.truncate("1y").dt.date().alias("time_period")
            )
            time_format = "%Y"
        else:
            time_expr = pl.col(time_column).dt.date().alias("time_period")
            time_format = "%Y-%m-%d"

        df = df.with_columns(time_expr)
    else:
        # Numeric binning
        if numeric_interval is None or numeric_interval <= 0:
            raise ValueError(
                "numeric_interval must be a positive number for numeric sequential analysis"
            )
        numeric_interval_value = float(numeric_interval)
        if numeric_origin is not None:
            numeric_origin_value = float(numeric_origin)
        else:
            origin_series = df.select(
                pl.col(time_column).cast(pl.Float64()).min()
            ).to_series()
            numeric_origin_value = origin_series[0] if len(origin_series) else None
        if numeric_origin_value is None:
            raise ValueError(
                "Unable to determine numeric_origin from the provided data"
            )

        df = df.with_columns(
            pl.col(time_column).cast(pl.Float64()).alias("__numeric_value__"),
        )
        df = df.with_columns(
            (
                (pl.col("__numeric_value__") - pl.lit(numeric_origin_value))
                / pl.lit(numeric_interval_value)
            )
            .floor()
            .cast(pl.Int64)
            .alias("__numeric_bin__"),
        )
        df = df.with_columns(
            (
                pl.lit(numeric_origin_value)
                + pl.col("__numeric_bin__").cast(pl.Float64)
                * pl.lit(numeric_interval_value)
            ).alias("time_period"),
        )

    # Determine grouping columns
    group_cols = ["time_period"] + (group_by_columns or [])

    # Perform aggregation
    result_df = df.group_by(group_cols).agg([
        pl.len().alias("sequential_count"),
        pl.col(time_column).min().alias("period_start"),
        pl.col(time_column).max().alias("period_end"),
    ])

    # Add formatted time period for display
    if normalized_column_type == "datetime":
        if frequency == "weekly":
            result_df = result_df.with_columns(
                pl
                .col("time_period")
                .dt.strftime("%Y-W%W")
                .alias("time_period_formatted")
            )
        elif frequency == "quarterly":
            result_df = result_df.with_columns([
                pl.col("time_period").dt.year().alias("__year__"),
                ((pl.col("time_period").dt.month() - 1).floordiv(3).add(1)).alias(
                    "__quarter__"
                ),
            ])
            result_df = result_df.with_columns(
                pl.format(
                    "{}-Q{}",
                    pl.col("__year__"),
                    pl.col("__quarter__"),
                ).alias("time_period_formatted")
            ).drop(["__year__", "__quarter__"])
        else:
            result_df = result_df.with_columns(
                pl
                .col("time_period")
                .dt.strftime(time_format)
                .alias("time_period_formatted")
            )
    else:
        interval_lit = pl.lit(numeric_interval_value)
        result_df = result_df.with_columns([
            pl.col("time_period").round(6).alias("time_period"),
            (pl.col("time_period") + interval_lit).alias("__numeric_period_end__"),
        ])

        def _format_numeric(value: Optional[float]) -> Optional[str]:
            if value is None:
                return None
            return format(value, ".6g")

        result_df = result_df.with_columns([
            pl
            .col("time_period")
            .map_elements(_format_numeric, return_dtype=pl.String)
            .alias("__numeric_period_label_start__"),
            pl
            .col("__numeric_period_end__")
            .map_elements(_format_numeric, return_dtype=pl.String)
            .alias("__numeric_period_label_end__"),
        ])
        result_df = result_df.with_columns(
            pl.format(
                "[{}, {})",
                pl.col("__numeric_period_label_start__"),
                pl.col("__numeric_period_label_end__"),
            ).alias("time_period_formatted")
        ).drop([
            "__numeric_period_end__",
            "__numeric_period_label_start__",
            "__numeric_period_label_end__",
        ])

    # Sort by time if requested
    if sort_by_time:
        sort_cols = ["time_period"] + (group_by_columns or [])
        result_df = result_df.sort(sort_cols)

    return result_df


@router.post("/nodes/{node_id}/sequential-analysis")
async def run_sequential_analysis(
    node_id: str,
    request: SequentialAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run sequential analysis for one node and persist/update task payload.

    Used by:
    - frontend sequential-analysis run action

    Why:
    - Produces aggregated time-series counts and stores them as current task data.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)
    existing_task_ids = task_manager.get_current_task_ids("sequential_analysis")
    existing_task = (
        task_manager.get_task(existing_task_ids[0]) if existing_task_ids else None
    )
    if existing_task and existing_task.request:
        try:
            existing_req_dict = existing_task.request.model_dump()
            current_req_dict = request.model_dump()
            current_req_dict["node_id"] = node_id

            # Remove task_id if present in existing request
            existing_req_dict.pop("task_id", None)

            if existing_req_dict != current_req_dict:
                raise HTTPException(
                    status_code=409,
                    detail="Clear current sequential analysis results before starting a new run",
                )
        except HTTPException:
            raise
        except Exception as exc:
            logger.debug(
                "Failed to compare sequential-analysis request payloads for task reuse: %s",
                exc,
            )

    try:
        try:
            node = ws.nodes[node_id]
        except Exception:
            raise HTTPException(status_code=404, detail="Node not found")
        node_data = getattr(node, "data", None)
        if node_data is None:
            raise HTTPException(status_code=400, detail="Node has no data")

        if not isinstance(node_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail="Node data must be a LazyFrame",
            )

        schema = node_data.collect_schema()

        # Determine available columns
        available_columns = list(schema.names())

        def normalize_type_name(value: object | None) -> str | None:
            if value is None:
                return None
            text = str(value).lower()
            if any(token in text for token in ("datetime", "timestamp")):
                return "datetime"
            if "date" in text and "update" not in text:
                return "datetime"
            if "time" in text and "interval" not in text:
                return "datetime"
            if "int" in text and "interval" not in text:
                return "integer"
            if any(
                token in text for token in ("float", "double", "decimal", "numeric")
            ):
                return "float"
            return None

        column_type_lookup: dict[str, str] = {}

        def register_type(name: object, raw: object | None) -> None:
            if not isinstance(name, str):
                return
            normalized = normalize_type_name(raw)
            if normalized:
                column_type_lookup.setdefault(name, normalized)

        for name, raw in zip(schema.names(), schema.dtypes()):
            register_type(name, raw)

        if available_columns and request.time_column not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Time column '{request.time_column}' not found. Available columns: {available_columns}",
            )

        if request.group_by_columns:
            if len(request.group_by_columns) > 3:
                raise HTTPException(
                    status_code=400, detail="Maximum 3 group by columns allowed"
                )
            for col in request.group_by_columns:
                if available_columns and col not in available_columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Group by column '{col}' not found. Available columns: {available_columns}",
                    )

        inferred_type = column_type_lookup.get(request.time_column)
        numeric_types = {"integer", "float"}
        if (
            request.column_type == "numeric"
            and inferred_type
            and inferred_type not in numeric_types
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Column '{request.time_column}' is not numeric based on schema metadata; "
                    "select a numeric column or choose column_type='datetime'."
                ),
            )
        if (
            request.column_type == "datetime"
            and inferred_type
            and inferred_type in numeric_types
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Column '{request.time_column}' appears to be numeric; "
                    "choose column_type='numeric' to bin numeric values."
                ),
            )

        valid_frequencies = [
            "hourly",
            "daily",
            "weekly",
            "monthly",
            "quarterly",
            "yearly",
        ]
        if (
            request.column_type == "datetime"
            and request.frequency not in valid_frequencies
        ):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid frequency '{request.frequency}'. Valid options: {valid_frequencies}",
            )

        sequential_result = _run_sequential_analysis(
            node_data,
            time_column=request.time_column,
            group_by_columns=request.group_by_columns,
            frequency=request.frequency,
            sort_by_time=request.sort_by_time,
            column_type=request.column_type,
            numeric_origin=request.numeric_origin,
            numeric_interval=request.numeric_interval,
        )

        inherited_chart_type = DEFAULT_CHART_TYPE
        if existing_task and existing_task.result:
            previous_result = existing_task.result.to_json()
            if (
                isinstance(previous_result, dict)
                and isinstance(previous_result.get("chart_type"), str)
                and previous_result["chart_type"] in VALID_CHART_TYPES
            ):
                inherited_chart_type = previous_result["chart_type"]

        result_payload = {
            "state": "successful",
            "data": sequential_result.to_dicts(),
            "columns": list(sequential_result.columns),
            "total_records": len(sequential_result),
        }

        result_payload["chart_type"] = inherited_chart_type

        # Create/Update task
        req_dict = request.model_dump()
        req_dict["node_id"] = node_id

        req_model = AnalysisSequentialAnalysisRequest(**req_dict)

        if existing_task:
            task = existing_task
            task.request = req_model
            task.complete(GenericAnalysisResult(result_payload))
            task_manager.save_task(task)
        else:
            task_id = task_manager.create_task(req_model)
            task = task_manager.get_task(task_id)
            task.request = req_model
            task.complete(GenericAnalysisResult(result_payload))
            task_manager.save_task(task)
            task_manager.set_current_task("sequential_analysis", task_id)

        result_payload["metadata"] = {"task_id": task.task_id}
        return result_payload

    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        import traceback

        print(f"ERROR: Unexpected sequential analysis error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.get("/sequential-analysis/tasks/current")
async def sequential_analysis_current_tasks(
    current_user: dict = Depends(get_current_user),
):
    """Return current task IDs for sequential-analysis."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    return await get_current_task_ids_for_analysis(
        user_id, workspace_id, ["sequential_analysis", "sequential-analysis"]
    )


@router.get("/sequential-analysis/tasks/{task_id}/request")
async def sequential_analysis_task_request(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return stored request payload for a sequential-analysis task."""
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


@router.get("/sequential-analysis/tasks/{task_id}/result")
async def sequential_analysis_task_result(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return stored result payload for a sequential-analysis task."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)

    task = await ensure_task_synced(user_id, workspace_id, task_id, task_manager)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = task.result
    if result is None:
        return {"state": "pending", "metadata": {"task_id": task_id}}

    return result.to_json()


@router.post("/sequential-analysis/tasks/{task_id}/result")
async def update_sequential_analysis_task_result(
    task_id: str,
    updates: dict | None,
    current_user: dict = Depends(get_current_user),
):
    """Persist display-only sequential analysis options on a saved task.

    Used by:
    - frontend chart-type preference updates

    Why:
    - Avoids recomputation when only chart presentation changes.

    Refactor note:
    - Mirrors preference update behavior in other analyses; a shared
        task-preferences helper could reduce duplication.
    """
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")
    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if not task or not task.result:
        raise HTTPException(status_code=404, detail="No sequential analysis found")

    result_payload = task.result.to_json()
    if not isinstance(result_payload, dict):
        result_payload = {}

    chart_type = result_payload.get("chart_type")
    if not isinstance(chart_type, str) or chart_type not in VALID_CHART_TYPES:
        chart_type = DEFAULT_CHART_TYPE

    if isinstance(updates, dict) and "chart_type" in updates:
        candidate = updates["chart_type"]
        if not isinstance(candidate, str) or candidate not in VALID_CHART_TYPES:
            raise HTTPException(
                status_code=400,
                detail="Invalid chart type. Valid options are: line, bar, area",
            )
        chart_type = candidate

    result_payload["chart_type"] = chart_type

    task.result = GenericAnalysisResult(result_payload)
    task.status = AnalysisStatus.COMPLETED
    task_manager.save_task(task)

    return {
        "state": "successful",
        "message": "saved",
        "data": {"chart_type": chart_type},
    }
