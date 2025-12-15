"""Sequential Analysis endpoints extracted from monolithic base module.

Exposes updated paths:
    GET  /workspaces/{workspace_id}/sequential-analysis/current-request
    GET  /workspaces/{workspace_id}/sequential-analysis/current-result
    POST /workspaces/{workspace_id}/nodes/{node_id}/sequential-analysis
"""

from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.sequential_analysis import (
    SequentialAnalysisRequest as AnalysisSequentialAnalysisRequest,
)
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import SequentialAnalysisRequest
from ..utils import get_node_with_data_or_400

router = APIRouter(prefix="/workspaces")


VALID_CHART_TYPES = {"line", "bar", "area"}
DEFAULT_CHART_TYPE = "line"
SEQUENTIAL_TASK = "sequential_analysis"


@router.get("/{workspace_id}/sequential-analysis/current-request")
async def sequential_analysis_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return None

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task(SEQUENTIAL_TASK)
    if not task:
        return None

    req = (
        task.request.model_dump()
        if hasattr(task.request, "model_dump")
        else task.request.dict()
    )
    return {"state": "successful", "message": "ok", "data": req}


@router.get("/{workspace_id}/sequential-analysis/current-result")
async def sequential_analysis_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return None

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task(SEQUENTIAL_TASK)
    if not task or not task.result:
        return None

    stored_result = task.result.to_json()
    stored_result = stored_result if isinstance(stored_result, dict) else {}
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
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    existing_task = analysis_manager.get_current_task(SEQUENTIAL_TASK)
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
        except Exception:
            pass

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

        inherited_chart_type = DEFAULT_CHART_TYPE
        if existing_task and existing_task.result:
            previous_result = existing_task.result.to_json()
            if (
                isinstance(previous_result, dict)
                and isinstance(previous_result.get("chart_type"), str)
                and previous_result["chart_type"] in VALID_CHART_TYPES
            ):
                inherited_chart_type = previous_result["chart_type"]

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

        # Create/Update task
        req_dict = request.model_dump()
        req_dict["node_id"] = node_id

        req_model = AnalysisSequentialAnalysisRequest(**req_dict)

        if existing_task:
            task = existing_task
            task.request = req_model
            task.complete(GenericAnalysisResult(result_payload))
            analysis_manager.update_task(task)
        else:
            task = analysis_manager.create_task(SEQUENTIAL_TASK, req_model)
            task.complete(GenericAnalysisResult(result_payload))
            analysis_manager.update_task(task)

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
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        return {"state": "successful", "cleared": {}}

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    analysis_manager.delete_task(SEQUENTIAL_TASK)

    # Also clear cache using the old helper for now, as it handles in-memory caches
    from ....core.analysis_admin import clear_analysis_cache_for

    cache_removed = clear_analysis_cache_for(user_id, workspace_id)

    return {
        "state": "successful",
        "cleared": {"analyses_removed": 1, "concordance_cache_removed": cache_removed},
    }


@router.post("/{workspace_id}/sequential-analysis/current-result")
async def update_sequential_analysis_current_result(
    workspace_id: str,
    updates: dict | None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")

    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager

        analysis_manager = get_analysis_manager(user_id, workspace_id)

    task = analysis_manager.get_current_task(SEQUENTIAL_TASK)
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

    # Update result
    task.result = GenericAnalysisResult(result_payload)
    analysis_manager.update_task(task)

    return {
        "state": "successful",
        "message": "saved",
        "data": {"chart_type": chart_type},
    }
