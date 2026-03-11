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
    include_document_column: bool = False,
    extra_columns_data: Optional[Dict[str, list]] = None,
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
        non_empty_mask = [bool(value.strip()) for value in corpus]
        filtered_corpus = [
            value for value, keep in zip(corpus, non_empty_mask) if keep
        ]

        source_column_name = "__quotation_source__"
        data: dict[str, list] = {source_column_name: filtered_corpus}
        output_columns: list[str] = []

        if include_document_column:
            data[document_column] = filtered_corpus
            output_columns.append(document_column)

        if extra_columns_data:
            for col_name, col_values in extra_columns_data.items():
                filtered_values = [
                    value for value, keep in zip(col_values, non_empty_mask) if keep
                ]
                data[col_name] = filtered_values
                output_columns.append(col_name)

        input_df = pl.DataFrame(data)

        if progress_callback:
            progress_callback(0.6, "Extracting quotations...")

        quote_df = quotation_via_polars_text(input_df, source_column_name)
        quote_df = ensure_quote_dataframe(quote_df)

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
                "output_columns": output_columns,
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
