"""Frequency Analysis endpoints extracted from monolithic base module.

Preserves original paths:
  GET  /workspaces/{workspace_id}/frequency-analysis/current-request
  GET  /workspaces/{workspace_id}/frequency-analysis/current-result
  POST /workspaces/{workspace_id}/nodes/{node_id}/frequency-analysis
"""

from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.frequency_analysis import \
    FrequencyAnalysisRequest as AnalysisFrequencyAnalysisRequest
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.workspace import workspace_manager
from ....models import FrequencyAnalysisRequest
from ..utils import get_node_with_data_or_400

router = APIRouter(prefix="/workspaces")


VALID_CHART_TYPES = {"line", "bar", "area"}
DEFAULT_CHART_TYPE = "line"


@router.get("/{workspace_id}/frequency-analysis/current-request")
async def frequency_analysis_current_request(
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
        
    task = analysis_manager.get_current_task("frequency_analysis")
    if not task:
        return None
        
    req = task.request.model_dump() if hasattr(task.request, "model_dump") else task.request.dict()
    return {"state": "successful", "message": "ok", "data": req}


@router.get("/{workspace_id}/frequency-analysis/current-result")
async def frequency_analysis_current_result(
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
        
    task = analysis_manager.get_current_task("frequency_analysis")
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


@router.post("/{workspace_id}/nodes/{node_id}/frequency-analysis")
async def get_frequency_analysis(
    workspace_id: str,
    node_id: str,
    request: FrequencyAnalysisRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run frequency analysis on a node with DocFrame integration."""
    user_id = current_user["id"]
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace not found")
        
    analysis_manager = getattr(ws, "analysis", None)
    if not analysis_manager:
        from ....analysis.manager import get_analysis_manager
        analysis_manager = get_analysis_manager(user_id, workspace_id)

    try:
        node, node_data = get_node_with_data_or_400(user_id, workspace_id, node_id)

        # Determine available columns
        if hasattr(node_data, "columns"):
            available_columns = node_data.columns
        elif hasattr(node_data, "schema"):
            available_columns = list(node_data.schema.keys())
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

        if not hasattr(node_data, "text"):
            raise HTTPException(
                status_code=400,
                detail="Node data does not support text analysis. Ensure it contains text data.",
            )

        frequency_result = node_data.text.frequency_analysis(  # type: ignore[attr-defined]
            time_column=request.time_column,
            group_by_columns=request.group_by_columns,
            frequency=request.frequency,
            sort_by_time=request.sort_by_time,
        )

        inherited_chart_type = DEFAULT_CHART_TYPE
        prev_task = analysis_manager.get_current_task("frequency_analysis")
        if prev_task and prev_task.result:
            previous_result = prev_task.result.to_json()
            if (
                isinstance(previous_result, dict)
                and isinstance(previous_result.get("chart_type"), str)
                and previous_result["chart_type"] in VALID_CHART_TYPES
            ):
                inherited_chart_type = previous_result["chart_type"]

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

        # Create AnalysisTask
        analysis_request = AnalysisFrequencyAnalysisRequest(
            node_id=node_id,
            time_column=request.time_column,
            group_by_columns=request.group_by_columns,
            frequency=request.frequency,
            sort_by_time=request.sort_by_time
        )

        if prev_task:
            # Check if request changed
            prev_req = prev_task.request
            new_req_dict = analysis_request.model_dump()
            prev_req_dict = prev_req.model_dump()
            
            if new_req_dict != prev_req_dict:
                 raise HTTPException(
                    status_code=409,
                    detail="Clear current frequency analysis results before starting a new run",
                )
            
            # Update existing task
            prev_task.request = analysis_request
            prev_task.complete(GenericAnalysisResult(result_payload))
            analysis_manager.update_task(prev_task)
            
        else:
            # Create new task
            from uuid import uuid4
            task_id = str(uuid4())
            analysis_request.task_id = task_id
            
            task = analysis_manager.create_task("frequency_analysis", analysis_request)
            task.complete(GenericAnalysisResult(result_payload))
            analysis_manager.update_task(task)

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
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if ws:
        analysis_manager = getattr(ws, "analysis", None)
        if not analysis_manager:
            from ....analysis.manager import get_analysis_manager
            analysis_manager = get_analysis_manager(user_id, workspace_id)
        
        analysis_manager.clear_current_result("frequency_analysis")
        
    return {"state": "successful", "cleared": ["frequency_analysis"]}


@router.post("/{workspace_id}/frequency-analysis/current-result")
async def update_frequency_analysis_current_result(
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
        
    task = analysis_manager.get_current_task("frequency_analysis")
    if not task:
        raise HTTPException(status_code=404, detail="No frequency analysis found")

    result_payload = task.result.to_json() if task.result else {}
    result_payload = result_payload if isinstance(result_payload, dict) else {}

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
        task.complete(GenericAnalysisResult(result_payload))
        analysis_manager.update_task(task)
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
        "data": {"chart_type": chart_type},
    }
