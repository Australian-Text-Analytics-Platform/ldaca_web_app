"""Analysis persistence stored directly in Workspace metadata.

Simplified implementation: analyses are appended to a list stored under the
workspace metadata key "analyses" and automatically serialized with the
workspace JSON. No filesystem directory for analysis records remains.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, UTC
from typing import Any, Dict, List, Optional

from .workspace import workspace_manager

_ANALYSES_META_KEY = "analyses"


@dataclass
class AnalysisRecord:
    task: str
    saved_at: str
    request: Dict[str, Any]
    result: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:  # Stable JSON shape
        return {
            "task": self.task,
            "saved_at": self.saved_at,
            "request": self.request,
            "result": self.result,
        }


def _get_workspace(user_id: str, workspace_id: str):
    return workspace_manager.get_workspace(user_id, workspace_id)


def _ensure_metadata_list(ws) -> List[Dict[str, Any]]:
    existing = ws.get_metadata(_ANALYSES_META_KEY)
    if not existing or not isinstance(existing, list):
        ws.set_metadata(_ANALYSES_META_KEY, [])
        return ws.get_metadata(_ANALYSES_META_KEY)  # type: ignore
    return existing  # type: ignore


def list_analyses(user_id: str, workspace_id: str) -> List[AnalysisRecord]:
    ws = _get_workspace(user_id, workspace_id)
    if not ws:
        return []
    meta_list = _ensure_metadata_list(ws)
    return [AnalysisRecord(**rec) for rec in meta_list]


def save_analysis(
    user_id: str,
    workspace_id: str,
    task: str,
    request_dict: Dict[str, Any],
    result_dict: Dict[str, Any],
) -> AnalysisRecord:
    ws = _get_workspace(user_id, workspace_id)
    if not ws:
        raise ValueError("Workspace not found")
    meta_list = _ensure_metadata_list(ws)
    # Ensure only the latest record is kept per task
    try:
        meta_list[:] = [rec for rec in meta_list if rec.get("task") != task]
    except Exception:
        # If unexpected structure, reset list
        ws.set_metadata(_ANALYSES_META_KEY, [])
        meta_list = _ensure_metadata_list(ws)
    record = AnalysisRecord(
        task=task,
        saved_at=datetime.now(UTC).isoformat(),
        request=request_dict,
        result=result_dict,
    )
    meta_list.append(record.to_dict())
    workspace_manager.persist(user_id, workspace_id)
    return record


def get_latest_analysis(
    user_id: str, workspace_id: str, task: str
) -> Optional[AnalysisRecord]:
    records = list_analyses(user_id, workspace_id)
    filtered = [r for r in records if r.task == task]
    return filtered[-1] if filtered else None
