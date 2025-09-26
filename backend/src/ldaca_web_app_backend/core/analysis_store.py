"""In-memory analysis persistence scoped to a workspace session.

Analysis requests/results now live exclusively in process memory and are not
serialized with workspace files. Data will be cleared whenever a workspace is
unloaded or the process restarts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional

from .json_utils import json_sanitize
from .workspace import workspace_manager


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


def _get_bucket(user_id: str, workspace_id: str) -> Optional[Dict[str, Dict[str, Any]]]:
    ws = workspace_manager.get_workspace(user_id, workspace_id)
    if ws is None:
        return None
    try:
        return workspace_manager.get_analysis_state(user_id, workspace_id)
    except ValueError:
        return None


def list_analyses(user_id: str, workspace_id: str) -> List[AnalysisRecord]:
    bucket = _get_bucket(user_id, workspace_id)
    if bucket is None:
        return []
    return [AnalysisRecord(**rec) for rec in bucket.values()]


def save_analysis(
    user_id: str,
    workspace_id: str,
    task: str,
    request_dict: Dict[str, Any],
    result_dict: Dict[str, Any],
) -> AnalysisRecord:
    bucket = _get_bucket(user_id, workspace_id)
    if bucket is None:
        raise ValueError("Workspace not found")

    # Sanitize data to prevent JSON serialization errors (e.g., numpy.int64 keys)
    sanitized_request = json_sanitize(request_dict)
    sanitized_result = json_sanitize(result_dict)

    record = AnalysisRecord(
        task=task,
        saved_at=datetime.now(UTC).isoformat(),
        request=sanitized_request,
        result=sanitized_result,
    )
    record_dict = record.to_dict()
    bucket.pop(task, None)  # Move latest to end of insertion order
    bucket[task] = record_dict
    return record


def get_latest_analysis(
    user_id: str, workspace_id: str, task: str
) -> Optional[AnalysisRecord]:
    bucket = _get_bucket(user_id, workspace_id)
    if bucket is None:
        return None
    record = bucket.get(task)
    return AnalysisRecord(**record) if record else None


def clear_analyses(user_id: str, workspace_id: str, task: Optional[str] = None) -> int:
    """Remove analyses from workspace metadata.

    Args:
        user_id: The user id
        workspace_id: The workspace id
        task: Optional task name to remove; if None, remove all analyses

    Returns:
        Number of analysis records removed
    """
    bucket = _get_bucket(user_id, workspace_id)
    if bucket is None:
        return 0
    if task is None:
        removed = len(bucket)
        bucket.clear()
        return removed
    return 1 if bucket.pop(task, None) else 0
