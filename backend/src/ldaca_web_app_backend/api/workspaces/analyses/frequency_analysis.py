"""Frequency Analysis endpoints extracted from monolithic base module.

Preserves original paths:
  GET  /workspaces/{workspace_id}/frequency-analysis/current-request
  GET  /workspaces/{workspace_id}/frequency-analysis/current-result
  POST /workspaces/{workspace_id}/nodes/{node_id}/frequency-analysis
"""

from fastapi import APIRouter, Depends, HTTPException

from ....core.analysis_store import clear_analyses, get_latest_analysis, save_analysis
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import FrequencyAnalysisRequest

router = APIRouter(prefix="/workspaces")


VALID_CHART_TYPES = {"line", "bar", "area"}
DEFAULT_CHART_TYPE = "line"


@router.get("/{workspace_id}/frequency-analysis/current-request")
async def frequency_analysis_current_request(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    rec = get_latest_analysis(user_id, workspace_id, task="frequency_analysis")
    if not rec:
        return None
    return {"state": "successful", "message": "ok", "data": rec.request}


@router.get("/{workspace_id}/frequency-analysis/current-result")
async def frequency_analysis_current_result(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    rec = get_latest_analysis(user_id, workspace_id, task="frequency_analysis")
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


@router.post("/{workspace_id}/nodes/{node_id}/frequency-analysis")
async def get_frequency_analysis(
    workspace_id: str,
    node_id: str,
    request: FrequencyAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run frequency analysis on a node with DocFrame integration."""
    user_id = current_user["id"]
    try:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        # Determine available columns
        if hasattr(node.data, "columns"):
            available_columns = node.data.columns
        elif hasattr(node.data, "schema"):
            available_columns = list(node.data.schema.keys())
        else:
            available_columns = []

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

        valid_frequencies = ["daily", "weekly", "monthly", "yearly"]
        if request.frequency not in valid_frequencies:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid frequency '{request.frequency}'. Valid options: {valid_frequencies}",
            )

        if not hasattr(node.data, "text"):
            raise HTTPException(
                status_code=400,
                detail="Node data does not support text analysis. Ensure it contains text data.",
            )

        frequency_result = node.data.text.frequency_analysis(  # type: ignore[attr-defined]
            time_column=request.time_column,
            group_by_columns=request.group_by_columns,
            frequency=request.frequency,
            sort_by_time=request.sort_by_time,
        )

        previous_record = get_latest_analysis(
            user_id, workspace_id, task="frequency_analysis"
        )
        inherited_chart_type = DEFAULT_CHART_TYPE
        if (
            previous_record
            and isinstance(previous_record.result, dict)
            and isinstance(previous_record.result.get("chart_type"), str)
            and previous_record.result["chart_type"] in VALID_CHART_TYPES
        ):
            inherited_chart_type = previous_record.result["chart_type"]

        if hasattr(frequency_result, "to_dicts"):
            result_payload = {
                "state": "successful",
                "data": frequency_result.to_dicts(),
                "columns": list(frequency_result.columns),
                "total_records": len(frequency_result),
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
                task="frequency_analysis",
                request_dict=req_dict,
                result_dict=result_payload,
            )
        except Exception as _e:  # pragma: no cover
            print(f"[analysis_persist] frequency_analysis save failed: {_e}")

        return result_payload

    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover
        import traceback

        print(f"ERROR: Unexpected frequency analysis error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@router.post("/{workspace_id}/frequency-analysis/clear")
async def clear_frequency_analysis_results(
    workspace_id: str, current_user: dict = Depends(get_current_user)
):
    user_id = current_user["id"]
    removed = clear_analyses(user_id, workspace_id, task="frequency_analysis")
    return {"state": "successful", "cleared": {"analyses_removed": removed}}


@router.post("/{workspace_id}/frequency-analysis/current-result")
async def update_frequency_analysis_current_result(
    workspace_id: str,
    updates: dict | None,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    record = get_latest_analysis(user_id, workspace_id, task="frequency_analysis")
    if not record:
        raise HTTPException(status_code=404, detail="No frequency analysis found")

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
            task="frequency_analysis",
            request_dict=request_payload,
            result_dict=result_payload,
        )
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist frequency analysis preferences: {exc}",
        )

    return {
        "state": "successful",
        "message": "saved",
        "data": {"chart_type": chart_type},
    }
