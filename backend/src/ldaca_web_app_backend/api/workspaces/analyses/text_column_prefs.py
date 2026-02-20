"""Shared text-column resolution/persistence helpers for text analyses.

Used by:
- token-frequency, concordance, and topic-modeling routes

Why:
- Centralizes column selection heuristics and preference persistence behavior.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import polars as pl
from fastapi import HTTPException

from ....core.workspace import workspace_manager

COMMON_TEXT_COLUMN_CANDIDATES = ("document", "text", "content", "body", "message")


def _resolve_text_column_for_node(
    *,
    node: Any,
    node_id: str,
    requested_column: str | None,
) -> str:
    """Resolve and validate a text column for one analysis node.

    Used by:
    - `resolve_text_columns_for_nodes`

    Why:
    - Centralizes column precedence and validation so all text analyses behave
            consistently.

    Precedence order:
      1) explicit request column
      2) node.metadata['text_column']
      3) common heuristic candidates
    """

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400,
            detail=f"Node {node_id} data must be a LazyFrame",
        )

    available_columns = list(node_data.collect_schema().names())

    column_name = requested_column
    if not column_name:
        metadata = getattr(node, "metadata", {}) or {}
        if isinstance(metadata, dict):
            column_name = metadata.get("text_column")

    if not column_name:
        for candidate in COMMON_TEXT_COLUMN_CANDIDATES:
            if candidate in available_columns:
                column_name = candidate
                break

    if not column_name:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Could not determine text column for node {node_id}. "
                f"Available columns: {available_columns}"
            ),
        )

    if column_name not in available_columns:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Column '{column_name}' not found in node {node_id}. "
                f"Available columns: {available_columns}"
            ),
        )

    return column_name


def persist_text_column_preference(node: Any, text_column: str) -> None:
    """Persist preferred text column metadata on a node (best effort).

    Used by:
    - `resolve_text_columns_for_nodes`

    Why:
    - Stores user intent so subsequent analyses can default to the same column.
    """
    try:
        if hasattr(node, "set_metadata"):
            node.set_metadata("text_column", text_column)
            return

        metadata = getattr(node, "metadata", None)
        if not isinstance(metadata, dict):
            metadata = {}
        metadata["text_column"] = text_column
        setattr(node, "metadata", metadata)
    except Exception:
        # Never fail analysis on metadata persistence issues.
        pass


def resolve_text_columns_for_nodes(
    *,
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    requested_node_columns: dict[str, str] | None,
    persist_preference: bool = True,
) -> dict[str, str]:
    """Resolve validated node-to-text-column mappings for analyses.

    Used by:
    - `token_frequencies.calculate_token_frequencies`
    - `concordance.run_concordance`
    - `topic_modeling.run_topic_modeling`

    Why:
    - Removes duplicated text-column heuristics across routes and preserves
      consistent preference persistence behavior.
    """

    requested = requested_node_columns or {}
    resolved: dict[str, str] = {}

    for node_id in node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        column_name = _resolve_text_column_for_node(
            node=node,
            node_id=node_id,
            requested_column=requested.get(node_id),
        )
        resolved[node_id] = column_name

        if persist_preference:
            persist_text_column_preference(node, column_name)

    if persist_preference:
        try:
            workspace = workspace_manager.get_workspace(user_id, workspace_id)
            if workspace is not None:
                workspace.set_metadata("modified_at", datetime.now().isoformat())
                target_dir = workspace_manager._resolve_workspace_dir(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    workspace_name=workspace.name,
                )
                workspace_manager._attach_workspace_dir(workspace, target_dir)
                workspace.save(target_dir)
                workspace_manager._set_cached_path(user_id, workspace_id, target_dir)
        except Exception:
            # Best-effort only.
            pass

    return resolved


def guess_text_column(*, available_columns: list[str]) -> str | None:
    """Guess a preferred text column from available names.

    Used by:
    - `api.workspaces.nodes` text-column fallback paths

    Why:
    - Preserves legacy helper API while reusing shared candidate precedence.
    """
    for candidate in COMMON_TEXT_COLUMN_CANDIDATES:
        if candidate in available_columns:
            return candidate
    return None
