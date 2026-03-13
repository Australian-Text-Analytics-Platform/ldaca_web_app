"""Worker implementations for quotation background tasks."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from ..api.workspaces.analyses.generated_columns import (
    QUOTE_COLUMN_NAMES,
    QUOTE_QUOTE_COLUMN,
)


def run_quotation_detach_task(
    configure_worker_environment,
    workspace_dir: str,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    engine_config: Dict[str, Any],
    new_node_name: str,
    include_document_column: bool = False,
    extra_columns_data: Optional[Dict[str, list]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Run quotation detach and return a serialized detached node payload."""
    configure_worker_environment()

    try:
        import os

        import polars as pl
        from docworkspace import Node
        from ldaca_web_app_backend.api.workspaces.analyses.quotation_core import (
            ensure_quote_dataframe,
            quotation_via_polars_text,
        )

        print(f"[Worker {os.getpid()}] Starting quotation detach task")

        if progress_callback:
            progress_callback(0.2, "Preparing corpus...")

        corpus = [str(v) if v is not None else "" for v in (node_corpus or [])]
        non_empty_mask = [bool(value.strip()) for value in corpus]
        filtered_corpus = [value for value, keep in zip(corpus, non_empty_mask) if keep]

        source_column_name = "__quotation_source__"
        data: dict[str, list] = {source_column_name: filtered_corpus}
        selected_columns: list[str] = []
        output_columns: list[str] = []

        if include_document_column:
            data[document_column] = filtered_corpus
            selected_columns.append(document_column)
            output_columns.append(document_column)

        if extra_columns_data:
            for col_name, col_values in extra_columns_data.items():
                filtered_values = [
                    value for value, keep in zip(col_values, non_empty_mask) if keep
                ]
                data[col_name] = filtered_values
                selected_columns.append(col_name)
                output_columns.append(col_name)

        input_df = pl.DataFrame(data)

        if progress_callback:
            progress_callback(0.6, "Extracting quotations...")

        quote_df = quotation_via_polars_text(input_df, source_column_name)
        quote_df = ensure_quote_dataframe(quote_df)
        generated_columns = [
            column_name
            for column_name in QUOTE_COLUMN_NAMES
            if column_name in quote_df.columns
        ]
        quote_df = quote_df.select(selected_columns + generated_columns)

        if QUOTE_QUOTE_COLUMN in quote_df.columns:
            quote_df = quote_df.filter(pl.col(QUOTE_QUOTE_COLUMN).is_not_null())

        if progress_callback:
            progress_callback(0.8, "Serializing detached node...")

        detached_node = Node(
            data=quote_df.lazy(),
            name=new_node_name,
            workspace=None,
            operation="quotation_detach",
            parents=[parent_node_id],
            document=document_column,
        )
        node_payload = detached_node.to_dict(base_dir=workspace_dir)

        if progress_callback:
            progress_callback(1.0, "Task completed successfully")

        print(f"[Worker {os.getpid()}] Quotation detach task completed successfully")

        return {
            "state": "successful",
            "result": {
                "node_payload": node_payload,
                "output_columns": output_columns + generated_columns,
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
