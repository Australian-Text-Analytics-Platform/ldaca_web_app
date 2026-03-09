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
    extra_columns_data: Optional[Dict[str, list]] = None,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Run concordance detach with API-prepared corpus and write artifact parquet."""
    configure_worker_environment()

    try:
        import os
        from pathlib import Path

        import polars as pl
        import polars_text as pt

        print(f"[Worker {os.getpid()}] Starting concordance detach task")

        if progress_callback:
            progress_callback(0.2, "Preparing corpus...")

        corpus = [str(v) if v is not None else "" for v in (node_corpus or [])]

        # Build aligned mask for non-empty rows
        non_empty_mask = [bool(v.strip()) for v in corpus]
        corpus = [v for v, keep in zip(corpus, non_empty_mask) if keep]

        if progress_callback:
            progress_callback(0.5, "Generating concordance...")

        data: dict[str, list] = {document_column: corpus}
        extra_col_names: list[str] = []
        if extra_columns_data:
            for col_name, col_values in extra_columns_data.items():
                filtered = [v for v, keep in zip(col_values, non_empty_mask) if keep]
                data[col_name] = filtered
                extra_col_names.append(col_name)

        df = pl.DataFrame(data)
        result = (
            df
            .select([
                pl.all(),
                pt.concordance(
                    pl.col(document_column),
                    search_word,
                    num_left_tokens=num_left_tokens,
                    num_right_tokens=num_right_tokens,
                    regex=regex,
                    case_sensitive=case_sensitive,
                ).alias("concordance"),
            ])
            .explode("concordance")
            .unnest("concordance")
            .filter(pl.col("matched_text").is_not_null())
        )

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
                "output_columns": ["left_context", "matched_text", "right_context"]
                + extra_col_names,
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
