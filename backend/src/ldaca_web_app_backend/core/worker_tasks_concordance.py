"""Worker implementations for concordance background tasks."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional


def run_concordance_detach_task(
    configure_worker_environment,
    node_corpus: list[str],
    parent_node_id: str,
    document_column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    case_sensitive: bool,
    new_node_name: str,
    artifact_dir: str,
    artifact_prefix: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Run concordance detach with API-prepared corpus and write artifact parquet."""
    configure_worker_environment()

    try:
        import os
        import re
        from pathlib import Path

        import polars as pl
        import polars_text as pt

        print(f"[Worker {os.getpid()}] Starting concordance detach task")

        if progress_callback:
            progress_callback(0.2, "Preparing corpus...")

        corpus = [str(v) if v is not None else "" for v in (node_corpus or [])]
        corpus = [value for value in corpus if value.strip()]

        if progress_callback:
            progress_callback(0.5, "Generating concordance...")

        escaped_word = re.escape(search_word)
        pattern = escaped_word if not regex else search_word
        if not case_sensitive:
            pattern = f"(?i){pattern}"

        left_col_name = f"{document_column}_left"
        search_col_name = f"{document_column}_search"
        right_col_name = f"{document_column}_right"

        result = pt.StringNamespace.to_concordance(
            pl.Series(corpus), pattern, num_left_tokens, num_right_tokens
        ).filter(pl.col(search_col_name).is_not_null())

        if progress_callback:
            progress_callback(0.8, "Writing artifact...")

        artifact_root = Path(artifact_dir)
        artifact_root.mkdir(parents=True, exist_ok=True)
        prefix = (
            artifact_prefix or "concordance_detach"
        ).strip() or "concordance_detach"
        output_file = artifact_root / f"{prefix}.parquet"
        result.write_parquet(str(output_file))

        if progress_callback:
            progress_callback(1.0, "Task completed successfully")

        print(f"[Worker {os.getpid()}] Concordance detach task completed successfully")

        return {
            "state": "successful",
            "result": {
                "parquet_path": str(output_file),
                "new_node_name": new_node_name,
                "parent_node_id": parent_node_id,
                "document_column": document_column,
                "output_columns": [left_col_name, search_col_name, right_col_name],
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
