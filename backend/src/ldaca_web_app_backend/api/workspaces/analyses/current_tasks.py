"""Shared helper for resolving current task IDs for an analysis type."""

from __future__ import annotations

from typing import Any, Dict

from ....analysis.manager import get_task_manager as get_analysis_task_manager


async def get_current_task_ids_for_analysis(
    user_id: str,
    workspace_id: str,
    analysis_keys: list[str],
) -> Dict[str, Any]:
    """Return current task IDs for an analysis type.

    Each analysis type stores at most one current task ID per key.

    Parameters:
        user_id: The authenticated user's ID.
        workspace_id: The active workspace ID.
        analysis_keys: Candidate key forms for the analysis (e.g. ["token_frequencies", "token-frequencies"]).

    Returns:
        dict: {"task_ids": [...]}
    """
    manager = get_analysis_task_manager(user_id)

    task_ids: list[str] = []
    for key in analysis_keys:
        for task_id in manager.get_current_task_ids(key):
            if task_id and task_id not in task_ids:
                task_ids.append(task_id)

    return {"task_ids": task_ids}
