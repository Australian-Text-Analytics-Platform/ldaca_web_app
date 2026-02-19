"""Concordance worker task implementations.

Separated from `worker.py` to keep worker orchestration code compact.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ldaca_web_app_backend.api.workspaces.analyses.concordance_core import (
    concordance_non_empty_expr,
)


def run_concordance_detach_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
    new_node_name: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute concordance detach in a worker process.

    Used by:
    - `core.worker.concordance_detach_task`
    - `TASK_REGISTRY["concordance_detach"]`

    Why:
    - Computes concordance matches and writes a detached parquet-backed node.
    """
    configure_worker_environment()

    try:
        import os
        import re

        import polars as pl
        import polars_text as pt
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(
            f"[Worker {os.getpid()}] Starting concordance detach task for workspace {workspace_id}"
        )

        if progress_callback:
            progress_callback(0.1, "Initializing workspace...")

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            success = workspace_manager.set_current_workspace(user_id, workspace_id)
            if success:
                workspace = workspace_manager.get_workspace(user_id, workspace_id)

        if not workspace:
            raise ValueError(
                f"Workspace {workspace_id} not found (worker process cannot access workspace)"
            )

        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if not workspace_dir:
            raise ValueError(f"Workspace folder not found for {workspace_id}")

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")

        node_data = getattr(node, "data", None)
        if not isinstance(node_data, pl.LazyFrame):
            raise ValueError(f"Node {node_id} data must be a LazyFrame")

        available_columns = list(node_data.collect_schema().names())

        if available_columns and column not in available_columns:
            raise ValueError(
                f"Column '{column}' not found. Available columns: {available_columns}"
            )

        if progress_callback:
            progress_callback(0.4, "Computing concordance matches...")

        expr = pt.concordance(
            pl.col(column),
            search_word,
            num_left_tokens=num_left_tokens,
            num_right_tokens=num_right_tokens,
            regex=regex,
            case_sensitive=case_sensitive,
        )
        concordance_lf = (
            node_data
            .with_columns(expr.alias("concordance"))
            .explode("concordance")
            .unnest("concordance")
            .filter(concordance_non_empty_expr())
        )

        if progress_callback:
            progress_callback(0.6, "Computing concordance frequencies...")

        l1_counts = concordance_lf.group_by("l1").agg(pl.len().alias("l1_freq"))
        r1_counts = concordance_lf.group_by("r1").agg(pl.len().alias("r1_freq"))
        final_data = (
            concordance_lf
            .join(l1_counts, on="l1", how="left")
            .join(r1_counts, on="r1", how="left")
            .with_columns([
                pl.col("l1_freq").fill_null(0).cast(pl.Int32),
                pl.col("r1_freq").fill_null(0).cast(pl.Int32),
            ])
            .collect()
        )

        if new_node_name:
            effective_node_name = new_node_name
        else:
            original_name = (
                node.name if hasattr(node, "name") and node.name else node_id
            )
            effective_node_name = f"{original_name}_conc_{search_word}"

        if progress_callback:
            progress_callback(0.8, "Persisting new node...")

        document_column = getattr(node, "document", None) or (
            (getattr(node, "metadata", {}) or {}).get("text_column")
            if hasattr(node, "metadata")
            else None
        )

        data_dir = workspace_dir / "data"
        data_dir.mkdir(parents=True, exist_ok=True)

        def _safe_stem(name: str) -> str:
            stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("._") or "data"
            return stem

        base_stem = _safe_stem(effective_node_name)
        parquet_path = data_dir / f"{base_stem}.parquet"
        suffix = 1
        while parquet_path.exists():
            parquet_path = data_dir / f"{base_stem}_{suffix}.parquet"
            suffix += 1

        final_data.write_parquet(parquet_path)
        pl.scan_parquet(parquet_path)

        if progress_callback:
            progress_callback(0.9, "Finalizing result...")

        total_rows = final_data.height

        if progress_callback:
            progress_callback(1.0, "Analysis completed, registering result...")

        return {
            "success": True,
            "message": f"Concordance analysis complete. Found {total_rows} matches.",
            "parquet_path": str(parquet_path),
            "new_node_name": effective_node_name,
            "parent_node_id": node_id,
            "document_column": document_column,
            "total_rows": total_rows,
            "concordance_matches": total_rows,
        }

    except Exception as e:
        print(f"[Worker] Concordance detach failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise
