"""Sequential Analysis endpoints extracted from monolithic base module.

Exposes updated paths:
    GET  /workspaces/{workspace_id}/sequential-analysis/current-request
    GET  /workspaces/{workspace_id}/sequential-analysis/current-result
    POST /workspaces/{workspace_id}/nodes/{node_id}/sequential-analysis
"""

from fastapi import APIRouter, Depends, HTTPException

from ....core.analysis_store import clear_analyses, get_latest_analysis, save_analysis
from ....core.auth import get_current_user
from ....models import SequentialAnalysisRequest
from ..utils import get_node_with_data_or_400

router = APIRouter(prefix="/workspaces")


VALID_CHART_TYPES = {"line", "bar", "area"}
DEFAULT_CHART_TYPE = "line"
SEQUENTIAL_TASK = "sequential_analysis"
LEGACY_TASKS = ("frequency_analysis",)


def _get_latest_record(user_id: str, workspace_id: str):
    """Fetch the latest sequential analysis record, checking legacy task names."""

    record = get_latest_analysis(user_id, workspace_id, task=SEQUENTIAL_TASK)
    if record:
        return record

    for legacy_task in LEGACY_TASKS:
        record = get_latest_analysis(user_id, workspace_id, task=legacy_task)
        if record:
            return record
    return None


def _clear_records(user_id: str, workspace_id: str) -> int:
    """Remove sequential analysis records across current and legacy task names."""

    removed = clear_analyses(user_id, workspace_id, task=SEQUENTIAL_TASK)
    for legacy_task in LEGACY_TASKS:
        removed += clear_analyses(user_id, workspace_id, task=legacy_task)
    return removed


@router.get("/{workspace_id}/sequential-analysis/current-request")
async def sequential_analysis_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    rec = _get_latest_record(user_id, workspace_id)
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.request}


@router.get("/{workspace_id}/sequential-analysis/current-result")
async def sequential_analysis_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    rec = _get_latest_record(user_id, workspace_id)
    if not rec:
        return None
    stored_result = rec.result if isinstance(rec.result, dict) else {}
    chart_type = (
        stored_result.get("chart_type") if isinstance(stored_result, dict) else None
    )
    if not isinstance(chart_type, str) or chart_type not in VALID_CHART_TYPES:
        stored_result = {
            **(stored_result or {}),
            "chart_type": DEFAULT_CHART_TYPE,
        }
    return {"state": "successful", "message": "ok", "data": stored_result}


@router.post("/{workspace_id}/nodes/{node_id}/sequential-analysis")
async def run_sequential_analysis(
    workspace_id: str,
    node_id: str,
    request: SequentialAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run sequential analysis on a node with DocFrame integration."""
    user_id = current_user["id"]
    try:
        node, node_data = get_node_with_data_or_400(user_id, workspace_id, node_id)

        # Determine available columns
        if hasattr(node_data, "columns"):
            available_columns = node_data.columns
        elif hasattr(node_data, "schema"):
            available_columns = list(node_data.schema.keys())
        else:
            available_columns = []

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

        schema_attr = getattr(node_data, "schema", None)
        if isinstance(schema_attr, list):
            for entry in schema_attr:
                if isinstance(entry, dict):
                    register_type(
                        entry.get("name"),
                        entry.get("js_type") or entry.get("type") or entry.get("dtype"),
                    )
        elif isinstance(schema_attr, dict):
            for name, raw in schema_attr.items():
                if isinstance(raw, dict):
                    register_type(
                        name, raw.get("js_type") or raw.get("type") or raw.get("dtype")
                    )
                else:
                    register_type(name, raw)

        dtypes_attr = getattr(node_data, "dtypes", None)
        if isinstance(dtypes_attr, dict):
            for name, raw in dtypes_attr.items():
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

        if not hasattr(node_data, "text"):
            raise HTTPException(
                status_code=400,
                detail="Node data does not support text analysis. Ensure it contains text data.",
            )

        sequential_result = node_data.text.sequential_analysis(  # type: ignore[attr-defined]
            time_column=request.time_column,
            group_by_columns=request.group_by_columns,
            frequency=request.frequency,
            sort_by_time=request.sort_by_time,
            column_type=request.column_type,
            numeric_origin=request.numeric_origin,
            numeric_interval=request.numeric_interval,
        )

        previous_record = _get_latest_record(user_id, workspace_id)
        inherited_chart_type = DEFAULT_CHART_TYPE
        if (
            previous_record
            and isinstance(previous_record.result, dict)
            and isinstance(previous_record.result.get("chart_type"), str)
            and previous_record.result["chart_type"] in VALID_CHART_TYPES
        ):
            inherited_chart_type = previous_record.result["chart_type"]

        if hasattr(sequential_result, "to_dicts"):
            result_payload = {
                "state": "successful",
                "data": sequential_result.to_dicts(),
                "columns": list(sequential_result.columns),
                "total_records": len(sequential_result),
            }
        else:
            result_payload = {
                "state": "successful",
                "data": [],
                "columns": [],
                "total_records": 0,
            }

        result_payload["chart_type"] = inherited_chart_type

        try:  # best-effort persistence
            req_dict = (
                request.model_dump()
                if hasattr(request, "model_dump")
                else request.dict()
            )
            req_dict = {**req_dict, "node_id": node_id}
            save_analysis(
                user_id=user_id,
                workspace_id=workspace_id,
                task=SEQUENTIAL_TASK,
                request_dict=req_dict,
                result_dict=result_payload,
            )
        except Exception as _e:  # pragma: no cover
            print(f"[analysis_persist] sequential_analysis save failed: {_e}")

        return result_payload

    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        import traceback

        print(f"ERROR: Unexpected sequential analysis error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.post("/{workspace_id}/sequential-analysis/clear")
async def clear_sequential_analysis_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    removed = _clear_records(user_id, workspace_id)
    return {"state": "successful", "cleared": {"analyses_removed": removed}}


@router.post("/{workspace_id}/sequential-analysis/current-result")
async def update_sequential_analysis_current_result(
    workspace_id: str,
    updates: dict | None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    record = _get_latest_record(user_id, workspace_id)
    if not record:
        raise HTTPException(status_code=404, detail="No sequential analysis found")

    request_payload = {**record.request} if isinstance(record.request, dict) else {}
    result_payload = {**record.result} if isinstance(record.result, dict) else {}

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

    try:
        save_analysis(
            user_id=user_id,
            workspace_id=workspace_id,
            task=SEQUENTIAL_TASK,
            request_dict=request_payload,
            result_dict=result_payload,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist sequential analysis preferences: {exc}",
        )

    return {
        "state": "successful",
        "message": "saved",
        "data": {"chart_type": chart_type},
    }
