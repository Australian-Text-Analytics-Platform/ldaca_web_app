"""Worker implementations for concordance background tasks."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from ..api.workspaces.analyses.generated_columns import (
    CONC_MATCHED_TEXT_COLUMN,
    CORE_CONCORDANCE_COLUMNS,
    concordance_struct_projection,
)


def run_concordance_detach_task(
    configure_worker_environment,
    workspace_dir: str,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
    new_node_name: str,
    include_document_column: bool = False,
    extra_columns_data: Optional[Dict[str, list]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Run concordance detach and return a serialized detached node payload."""
    configure_worker_environment()

    try:
        import os

        import polars as pl
        import polars_text as pt
        from docworkspace import Node

        print(f"[Worker {os.getpid()}] Starting concordance detach task")

        if progress_callback:
            progress_callback(0.2, "Preparing corpus...")

        corpus = [str(v) if v is not None else "" for v in (node_corpus or [])]

        # Build aligned mask for non-empty rows
        non_empty_mask = [bool(v.strip()) for v in corpus]
        corpus = [v for v, keep in zip(corpus, non_empty_mask) if keep]

        if progress_callback:
            progress_callback(0.5, "Generating concordance...")

        source_column_name = "__concordance_source__"
        data: dict[str, list] = {source_column_name: corpus}
        base_columns: list[pl.Expr] = []
        output_columns: list[str] = []

        if include_document_column:
            data[document_column] = corpus
            base_columns.append(pl.col(document_column))
            output_columns.append(document_column)

        extra_col_names: list[str] = []
        if extra_columns_data:
            for col_name, col_values in extra_columns_data.items():
                filtered = [v for v, keep in zip(col_values, non_empty_mask) if keep]
                data[col_name] = filtered
                extra_col_names.append(col_name)
                base_columns.append(pl.col(col_name))
                output_columns.append(col_name)

        df = pl.DataFrame(data)
        result = (
            df
            .select([
                *base_columns,
                pt.concordance(
                    pl.col(source_column_name),
                    search_word,
                    num_left_tokens=num_left_tokens,
                    num_right_tokens=num_right_tokens,
                    regex=regex,
                    case_sensitive=case_sensitive,
                ).alias("concordance"),
            ])
            .explode("concordance")
            .select([
                pl.exclude("concordance"),
                *concordance_struct_projection("concordance"),
            ])
            .filter(pl.col(CONC_MATCHED_TEXT_COLUMN).is_not_null())
        )

        if progress_callback:
            progress_callback(0.8, "Serializing detached node...")

        detached_node = Node(
            data=result.lazy(),
            name=new_node_name,
            workspace=None,
            operation="concordance_detach",
            parents=[parent_node_id],
            document=document_column,
        )
        node_payload = detached_node.to_dict(base_dir=workspace_dir)

        if progress_callback:
            progress_callback(1.0, "Task completed successfully")

        print(f"[Worker {os.getpid()}] Concordance detach task completed successfully")

        return {
            "state": "successful",
            "result": {
                "node_payload": node_payload,
                "output_columns": output_columns + list(CORE_CONCORDANCE_COLUMNS),
                "record_count": len(result),
            },
            "message": "Concordance detach completed successfully",
        }
    except Exception as e:
        return {
            "state": "failed",
            "error": str(e),
            "message": f"Concordance detach task failed: {str(e)}",
        }
