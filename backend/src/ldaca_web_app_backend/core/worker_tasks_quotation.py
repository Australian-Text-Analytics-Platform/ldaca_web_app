"""Quotation worker task implementations.

Separated from `worker.py` to keep worker orchestration code compact.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


def run_quotation_detach_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    node_id: str,
    column: str,
    engine_config: Dict[str, Any],
    new_node_name: Optional[str] = None,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute quotation detach in a worker process.

    Used by:
    - `core.worker.quotation_detach_task`
    - `TASK_REGISTRY["quotation_detach"]`

    Why:
    - Extracts quotations and materializes detached parquet output for node
      creation in task completion flow.

    Refactor note:
    - Imports `_compute_quote_dataframe` from API code; extract a shared public
      helper to reduce worker/API layering coupling.
    """
    configure_worker_environment()

    try:
        import asyncio
        import os
        import re

        import polars as pl
        from ldaca_web_app_backend.core.workspace import workspace_manager
        from ldaca_web_app_backend.models import QuotationEngineConfig

        print(
            f"[Worker {os.getpid()}] Starting quotation detach task for workspace {workspace_id}"
        )

        if progress_callback:
            progress_callback(0.1, "Initializing workspace...")

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            workspace_manager.set_current_workspace(user_id, workspace_id)
            workspace = workspace_manager.get_workspace(user_id, workspace_id)

        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found")

        workspace_dir = workspace_manager.get_workspace_dir(user_id, workspace_id)
        if not workspace_dir:
            raise ValueError("Workspace folder not found")

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise ValueError(f"Node {node_id} not found")

        node_data = getattr(node, "data", None)
        if not isinstance(node_data, pl.LazyFrame):
            raise ValueError(f"Node {node_id} data must be a LazyFrame")

        try:
            engine = QuotationEngineConfig.model_validate(engine_config)
        except Exception as e:
            raise ValueError(f"Invalid engine config: {e}")

        if progress_callback:
            progress_callback(0.4, "Extracting quotations...")

        # Compute quotes via shared quotation helper (keeps behavior aligned)
        base_df = node_data.collect()
        from ldaca_web_app_backend.api.workspaces.analyses.quotation import (
            _compute_quote_dataframe,
        )

        quote_df = asyncio.get_event_loop().run_until_complete(
            _compute_quote_dataframe(
                node,
                base_df,
                column,
                engine,
                use_base_only=True,
            )
        )

        if progress_callback:
            progress_callback(0.6, "Structuring results...")

        if "quote" in quote_df.columns:
            quote_df = quote_df.filter(pl.col("quote").is_not_null())

        final_data = quote_df

        if new_node_name:
            effective_node_name = new_node_name
        else:
            original_name = node.name if getattr(node, "name", None) else node_id
            effective_node_name = f"{original_name}_quotation"

        document_column = getattr(node, "document", None) or (
            (getattr(node, "metadata", {}) or {}).get("text_column")
            if hasattr(node, "metadata")
            else None
        )

        if progress_callback:
            progress_callback(0.8, "Persisting result...")

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
            "state": "successful",
            "message": f"Quotation extraction complete with {total_rows} rows",
            "parquet_path": str(parquet_path),
            "new_node_name": effective_node_name,
            "parent_node_id": node_id,
            "document_column": document_column,
            "total_rows": total_rows,
        }

    except Exception as e:
        print(f"[Worker] Quotation detach failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise
