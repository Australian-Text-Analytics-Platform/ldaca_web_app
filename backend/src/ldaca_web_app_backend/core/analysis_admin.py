"""Administrative analysis clearing utilities.

Consolidates logic previously embedded in workspace endpoints and
concordance module for clearing persisted analyses and in-memory caches.

Public helpers:
- clear_concordance_cache_for(user_id, workspace_id) -> int
- clear_analyses_and_cache(user_id, workspace_id, task: str | None) -> dict

The concordance cache is still owned by the concordance analysis code; we
import its CONCORDANCE_CACHE lazily to avoid circular imports when the
concordance router imports these helpers.
"""

from __future__ import annotations

from typing import Optional

from . import analysis_store

# Type alias for clarity
ClearedSummary = dict


def clear_concordance_cache_for(user_id: str, workspace_id: str) -> int:
    """Remove all cached concordance entries for a user/workspace pair.

    Returns number of cache entries removed.
    """
    try:
        # Local import to avoid circular import at module load time
        from ..api.workspaces.analyses.concordance import (
            CONCORDANCE_CACHE as _CACHE,  # type: ignore
        )
    except Exception:
        return 0
    to_remove = [k for k in _CACHE if k[0] == user_id and k[1] == workspace_id]
    for k in to_remove:
        _CACHE.pop(k, None)
    return len(to_remove)


def clear_analyses_and_cache(
    user_id: str, workspace_id: str, task: Optional[str]
) -> ClearedSummary:
    """Clear persisted analyses (optionally filtered by task), concordance cache,
    and task manager records (topic modeling) mirroring previous endpoint semantics.
    """
    removed = analysis_store.clear_analyses(user_id, workspace_id, task)

    cache_removed = 0
    if task is None or task in {"concordance", "multi_concordance"}:
        cache_removed = clear_concordance_cache_for(user_id, workspace_id)

    tasks_removed = 0
    if task is None or task in {"topic_modeling"}:
        from .workspace import workspace_manager

        tm = workspace_manager.get_task_manager(user_id, workspace_id)
        # task argument here intentionally passed through (will clear all if None)
        tasks_removed = tm.clear_tasks(
            task_type=task, user_id=user_id, workspace_id=workspace_id
        )

    return {
        "analyses_removed": removed,
        "concordance_cache_removed": cache_removed,
        "tasks_removed": tasks_removed,
    }


__all__ = ["clear_concordance_cache_for", "clear_analyses_and_cache"]
