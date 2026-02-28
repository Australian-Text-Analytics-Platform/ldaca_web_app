"""Worker implementations for quotation background tasks."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional


def run_quotation_detach_task(
    configure_worker_environment,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    engine_config: Dict[str, Any],
    new_node_name: str,
    artifact_dir: str,
    artifact_prefix: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Run quotation detach with API-prepared corpus and write artifact parquet."""
    configure_worker_environment()

    try:
        import os
        from pathlib import Path

        import polars as pl

        from ldaca_web_app_backend.api.workspaces.analyses.quotation_core import (
            ensure_quote_dataframe,
            quotation_via_polars_text,
        )

        print(f"[Worker {os.getpid()}] Starting quotation detach task")

        if progress_callback:
            progress_callback(0.2, "Preparing corpus...")

        corpus = [str(v) if v is not None else "" for v in (node_corpus or [])]
        corpus = [value for value in corpus if value.strip()]
        input_df = pl.DataFrame({document_column: corpus})

        if progress_callback:
            progress_callback(0.6, "Extracting quotations...")

        quote_df = quotation_via_polars_text(input_df, document_column)
        quote_df = ensure_quote_dataframe(quote_df, text_column=document_column)

        if progress_callback:
            progress_callback(0.8, "Writing artifact...")

        artifact_root = Path(artifact_dir)
        artifact_root.mkdir(parents=True, exist_ok=True)
        prefix = (artifact_prefix or "quotation_detach").strip() or "quotation_detach"
        output_file = artifact_root / f"{prefix}.parquet"
        quote_df.write_parquet(str(output_file))

        if progress_callback:
            progress_callback(1.0, "Task completed successfully")

        print(f"[Worker {os.getpid()}] Quotation detach task completed successfully")

        return {
            "state": "successful",
            "result": {
                "parquet_path": str(output_file),
                "new_node_name": new_node_name,
                "parent_node_id": parent_node_id,
                "document_column": document_column,
                "record_count": int(quote_df.height),
                "engine_config": engine_config,
            },
            "message": "Quotation detach completed successfully",
        }
    except Exception as e:
        return {
            "state": "failed",
            "error": str(e),
            "message": f"Quotation detach task failed: {str(e)}",
        }
