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

import asyncio
import logging
from typing import Optional

from . import analysis_store
from .workspace import workspace_manager

# Type alias for clarity
ClearedSummary = dict


logger = logging.getLogger(__name__)


def clear_concordance_cache_for(user_id: str, workspace_id: str) -> int:
    """Remove all cached concordance entries for a user/workspace pair.

    Returns number of cache entries removed.
    """
    try:
        # Local import to avoid circular import at module load time
        from ..api.workspaces.analyses.concordance import CONCORDANCE_CACHE as _CACHE  # type: ignore
    except Exception:
        return 0
    to_remove = [k for k in _CACHE if k[0] == user_id and k[1] == workspace_id]
    for k in to_remove:
        _CACHE.pop(k, None)
    return len(to_remove)


def clear_quotation_cache_for(user_id: str, workspace_id: str) -> int:
    """Remove cached quotation entries for the specified workspace."""

    try:
        from ..api.workspaces.analyses.quotation import QUOTATION_CACHE as _CACHE  # type: ignore[attr-defined]
    except Exception:
        return 0

    to_remove = [k for k in _CACHE if k[0] == user_id and k[1] == workspace_id]
    for key in to_remove:
        _CACHE.pop(key, None)
    return len(to_remove)


async def clear_analyses_and_cache(
    user_id: str, workspace_id: str, task: Optional[str]
) -> ClearedSummary:
    """Clear persisted analyses (optionally filtered by task), concordance cache,
    and task manager records. Task clearing is routed through ProcessTaskManager
    so callers can keep SSE task lists in sync with backend state.
    """

    removed = await asyncio.to_thread(
        analysis_store.clear_analyses, user_id, workspace_id, task
    )

    cache_removed = 0
    if task is None or task in {"concordance", "multi_concordance"}:
        cache_removed = clear_concordance_cache_for(user_id, workspace_id)

    tasks_removed = 0
    try:
        tm = workspace_manager.get_task_manager(user_id, workspace_id)
        tasks_removed = await tm.clear_tasks(
            task_type=task, user_id=user_id, workspace_id=workspace_id
        )
    except Exception as exc:  # pragma: no cover - defensive logging only
        logger.warning(
            "Failed to clear tasks for user=%s workspace=%s task=%s: %s",
            user_id,
            workspace_id,
            task,
            exc,
        )

    return {
        "analyses_removed": removed,
        "concordance_cache_removed": cache_removed,
        "tasks_removed": tasks_removed,
    }


__all__ = [
    "clear_concordance_cache_for",
    "clear_quotation_cache_for",
    "clear_analyses_and_cache",
]
