"""Process-worker implementations for quotation Analysis execution.

Used by:
- canonical Analysis execution and backend tests that exercise quotation
  computation from immutable inputs.

Flow: normalize source text, run local or remote quotation extraction, preserve
    source-row mappings, and return the owning Analysis result or child Data
    Block payload.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any
from collections.abc import Callable
import uuid

from ..analysis.generated_columns import (
    QUOTE_COLUMN_NAMES,
    QUOTE_EXTRACTION_COLUMN,
)
from .concordance import SOURCE_ROW_ID_COLUMN
from .utils import process_entrypoint

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from ..infrastructure.storage.input_snapshots import SnapshotNode
    from ..models.quotation import ResolvedQuotationEngine


def _collect_quotation_source_from_snapshot(
    *,
    snapshot_node: SnapshotNode,
    document_column: str,
) -> tuple[
    list[str],
    dict[str, list[Any]],
    dict[str, Any],
    list[int],
]:
    """Collect quotation source rows inside the worker process.

    Flow: select the document and metadata columns from the immutable input
    snapshot, filter blank documents, and return aligned values.
    """

    import polars as pl

    node_data = snapshot_node.data
    schema_names = list(node_data.collect_schema().names())
    if SOURCE_ROW_ID_COLUMN in schema_names:
        raise ValueError(f"Source column name is reserved: {SOURCE_ROW_ID_COLUMN}")
    node_data = node_data.with_row_index(SOURCE_ROW_ID_COLUMN)
    metadata_columns = [column for column in schema_names if column != document_column]

    corpus_df = (
        node_data.select(
            [
                pl.col(SOURCE_ROW_ID_COLUMN),
                pl.col(document_column),
                *[pl.col(c) for c in metadata_columns],
            ]
        )
        .filter(
            pl.col(document_column)
            .cast(pl.Utf8, strict=False)
            .str.strip_chars()
            .str.len_chars()
            .fill_null(0)
            > 0
        )
        .collect()
    )
    node_corpus = [
        str(value) if value is not None else ""
        for value in corpus_df.get_column(document_column).to_list()
    ]
    extra_columns_data: dict[str, list[Any]] = {}
    extra_columns_dtypes: dict[str, Any] = {}
    for column in metadata_columns:
        series = corpus_df.get_column(column)
        extra_columns_data[column] = series.to_list()
        extra_columns_dtypes[column] = series.dtype
    return (
        node_corpus,
        extra_columns_data,
        extra_columns_dtypes,
        [int(value) for value in corpus_df.get_column(SOURCE_ROW_ID_COLUMN).to_list()],
    )


@process_entrypoint
def run_quotation_run_all(
    artifact_dir: str,
    input_snapshot_dir: str,
    parent_node_id: uuid.UUID,
    document_column: str,
    engine: ResolvedQuotationEngine,
    quotation_service_max_batch_size: int,
    quotation_service_timeout: float,
    progress_callback: Callable[[float, str], None],
) -> dict[str, Any]:
    """Compute one complete immutable Quotation Result table."""
    try:
        progress_callback(0.02, "Loading quotation extractor...")

        import asyncio
        import os

        import polars as pl

        from ..analysis.quotation_core import compute_quotation_groups
        from ..domain.workspace import QuotationEngineType
        from ..infrastructure.providers.quotation_client import (
            QuotationProviderClient,
            QuotationServiceError,
        )
        from ..infrastructure.storage.input_snapshots import load_snapshot_node

        logger.info("[Worker %d] Starting quotation Run All", os.getpid())
        source_snapshot = load_snapshot_node(input_snapshot_dir, parent_node_id)

        progress_callback(0.2, "Preparing text data...")
        node_corpus, extra_columns_data, extra_columns_dtypes, source_row_ids = (
            _collect_quotation_source_from_snapshot(
                snapshot_node=source_snapshot,
                document_column=document_column,
            )
        )
        progress_callback(0.6, "Extracting quotations...")

        input_data: dict[str, list] = {
            SOURCE_ROW_ID_COLUMN: source_row_ids,
            document_column: node_corpus,
            QUOTE_EXTRACTION_COLUMN: node_corpus,
        }
        input_data.update(extra_columns_data)
        base_df = pl.DataFrame(input_data)
        base_df = base_df.with_columns(
            [
                pl.col(column).cast(dtype)
                for column, dtype in extra_columns_dtypes.items()
            ]
        )

        async def extract() -> pl.DataFrame:
            async def run_inline(function, *args):
                return function(*args)

            client = (
                QuotationProviderClient(default_timeout=quotation_service_timeout)
                if engine.type is QuotationEngineType.REMOTE
                else None
            )

            async def extract_remote(resolved_engine, documents):
                if client is None:
                    raise QuotationServiceError(
                        "Remote extraction requested for a local Analysis"
                    )
                return await client.extract(resolved_engine, documents)

            try:
                grouped = await compute_quotation_groups(
                    base_df,
                    document_column,
                    engine,
                    extract_remote_fn=extract_remote,
                    run_blocking=run_inline,
                    quotation_service_max_batch_size=quotation_service_max_batch_size,
                )
                return grouped
            finally:
                if client is not None:
                    await client.close()

        quote_df = (
            asyncio.run(extract())
            .filter(pl.col("quotation").list.len().fill_null(0) > 0)
            .sort(SOURCE_ROW_ID_COLUMN)
        )
        match_count_value = quote_df.select(pl.col("quotation").list.len().sum()).item()
        match_count = int(match_count_value or 0)
        output_columns = list(quote_df.columns)

        progress_callback(0.82, "Serializing quotation Result...")

        result_path = Path(artifact_dir) / "quotation-run-all.parquet"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        quote_df.write_parquet(result_path)

        progress_callback(0.95, "Saving quotation Result...")

        logger.info("[Worker %d] Quotation Run All completed successfully", os.getpid())

        return {
            "state": "successful",
            "source": {
                "node_id": parent_node_id,
                "node_name": source_snapshot.name,
                "color": source_snapshot.color,
                "document_column": document_column,
                "metadata_columns": [
                    column
                    for column in output_columns
                    if column
                    not in {
                        SOURCE_ROW_ID_COLUMN,
                        document_column,
                        QUOTE_EXTRACTION_COLUMN,
                        "quotation",
                        *QUOTE_COLUMN_NAMES,
                    }
                ],
                "analysis_columns": [
                    QUOTE_EXTRACTION_COLUMN,
                    *QUOTE_COLUMN_NAMES,
                ],
                "internal_columns": [SOURCE_ROW_ID_COLUMN],
                "table": {
                    "table_id": "quotation-run-all",
                    "artifact": str(result_path),
                    "supports_density": False,
                },
                "document_count": int(quote_df.height),
                "match_count": match_count,
            },
            "message": "Quotation Run All completed successfully",
        }
    except Exception:
        logger.exception("Quotation Run All failed")
        raise
