"""Administrative analysis clearing utilities.

Consolidates logic previously embedded in workspace endpoints and
concordance module for clearing persisted analyses and in-memory caches.

Public helpers:
- clear_analysis_cache_for(user_id, workspace_id) -> int
- clear_analyses_and_cache(user_id, workspace_id, task: str | None) -> dict

In-memory caches are still owned by each analysis module; we import them lazily
to avoid circular imports when analysis routers import these helpers.
"""

from __future__ import annotations

import importlib
import logging
from typing import Optional

from ..analysis.manager import get_analysis_manager
from .workspace import workspace_manager

# Type alias for clarity
ClearedSummary = dict


logger = logging.getLogger(__name__)


# Caches are keyed by tuples whose first two elements are (user_id, workspace_id).
# We intentionally clear ALL known caches for a workspace whenever analyses are
# cleared. This avoids task-specific cache-clearing rules and keeps semantics
# simple: "clear results" also means "drop any related in-memory caches".
_CACHE_SPECS: set[tuple[str, str]] = {
    ("ldaca_web_app_backend.api.workspaces.analyses.concordance", "CONCORDANCE_CACHE"),
}


def _clear_tuple_prefix_cache_for(
    user_id: str,
    workspace_id: str,
    *,
    module_path: str,
    cache_attr: str,
) -> int:
    """Clear an in-memory cache keyed by tuples beginning with (user_id, workspace_id).

    This is intentionally defensive: if the module/attr doesn't exist or isn't a
    mutable mapping, it returns 0.
    """

    try:
        mod = importlib.import_module(module_path)
        cache = getattr(mod, cache_attr)
    except Exception:
        return 0

    if not hasattr(cache, "keys") or not hasattr(cache, "pop"):
        return 0

    try:
        keys = list(cache.keys())
    except Exception:
        return 0

    to_remove: list[object] = []
    for k in keys:
        if (
            isinstance(k, tuple)
            and len(k) >= 2
            and k[0] == user_id
            and k[1] == workspace_id
        ):
            to_remove.append(k)

    removed = 0
    for k in to_remove:
        try:
            cache.pop(k, None)
            removed += 1
        except Exception:
            pass
    return removed


def clear_analysis_cache_for(user_id: str, workspace_id: str) -> int:
    """Clear analysis in-memory caches for a workspace.

    Clears all known analysis caches for the workspace.
    """

    return sum(
        _clear_tuple_prefix_cache_for(
            user_id,
            workspace_id,
            module_path=module_path,
            cache_attr=cache_attr,
        )
        for module_path, cache_attr in _CACHE_SPECS
    )


async def clear_analyses_and_cache(
    user_id: str, workspace_id: str, task: Optional[str]
) -> ClearedSummary:
    """Clear persisted analyses (optionally filtered by task), concordance cache,
    and task manager records. Task clearing is routed through ProcessTaskManager
    so callers can keep SSE task lists in sync with backend state.
    """

    cleared_task_ids: list[str] = []
    analysis_manager = get_analysis_manager(user_id, workspace_id)

    if task is None:
        cleared_task_ids = analysis_manager.clear_all()
    else:
        cleared = analysis_manager.delete_task(task)
        cleared_task_ids = [cleared] if cleared is not None else []

    cache_removed = clear_analysis_cache_for(user_id, workspace_id)

    tasks_removed = 0
    if cleared_task_ids:
        try:
            tm = workspace_manager.get_task_manager(user_id, workspace_id)
            for task_id in cleared_task_ids:
                try:
                    if await tm.clear_task(task_id):
                        tasks_removed += 1
                except Exception:
                    pass
        except Exception as exc:  # pragma: no cover - defensive logging only
            logger.warning(
                "Failed to clear tasks for user=%s workspace=%s task=%s: %s",
                user_id,
                workspace_id,
                task,
                exc,
            )

    return {
        "analyses_removed": len(cleared_task_ids),
        "concordance_cache_removed": cache_removed,
        "tasks_removed": tasks_removed,
    }


__all__ = [
    "clear_analysis_cache_for",
    "clear_analyses_and_cache",
]
