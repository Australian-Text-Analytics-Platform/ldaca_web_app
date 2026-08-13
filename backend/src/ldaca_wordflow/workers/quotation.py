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
from typing import Any, Callable

from ..analysis.generated_columns import (
    QUOTE_COLUMN_NAMES,
    QUOTE_EXTRACTION_COLUMN,
    QUOTE_QUOTE_COLUMN,
)
from .concordance import SOURCE_ROW_ID_COLUMN
from .utils import process_entrypoint

logger = logging.getLogger(__name__)


def _collect_quotation_source_from_snapshot(
    *,
    input_snapshot_dir: str,
    node_id: str,
    document_column: str,
    extra_column_names: list[str] | None,
    include_all_metadata: bool = False,
) -> tuple[
    list[str],
    dict[str, list] | None,
    dict[str, Any] | None,
    list[int],
]:
    """Collect quotation source rows inside the worker process.

    Used by:
    - root and child quotation Analysis workers using immutable LazyFrame-plan
      snapshots instead of full Python corpora.

    Flow: load the snapshotted node plan, select the document and requested
    metadata columns, filter blank documents, and return aligned lists for the
    existing quotation extraction builder.
    """

    import polars as pl

    from .input_snapshots import load_snapshot_node

    snapshot_node = load_snapshot_node(input_snapshot_dir, node_id)
    node_data = snapshot_node.data
    schema_names = list(node_data.collect_schema().names())
    if SOURCE_ROW_ID_COLUMN in schema_names:
        raise ValueError(f"Source column name is reserved: {SOURCE_ROW_ID_COLUMN}")
    node_data = node_data.with_row_index(SOURCE_ROW_ID_COLUMN)
    if include_all_metadata:
        metadata_columns = [
            column
            for column in schema_names
            if column != document_column
        ]
    else:
        metadata_columns = list(extra_column_names or [])

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
    if not metadata_columns:
        return (
            node_corpus,
            None,
            None,
            [
                int(value)
                for value in corpus_df.get_column(SOURCE_ROW_ID_COLUMN).to_list()
            ],
        )

    extra_columns_data: dict[str, list] = {}
    extra_columns_dtypes: dict[str, Any] = {}
    for column in metadata_columns:
        series = corpus_df.get_column(column)
        extra_columns_data[column] = series.to_list()
        extra_columns_dtypes[column] = series.dtype
    return (
        node_corpus,
        extra_columns_data,
        extra_columns_dtypes,
        [
            int(value)
            for value in corpus_df.get_column(SOURCE_ROW_ID_COLUMN).to_list()
        ],
    )


def _build_quotation_occurrence_dataframe(
    node_corpus: list[str],
    document_column: str,
    include_document_column: bool,
    extra_columns_data: dict[str, list] | None,
    extra_columns_dtypes: dict[str, Any] | None = None,
):
    """Extract quotation occurrences from a corpus. Returns (df, output_columns).

    Called by:
    - Quotation Run All Analyses that recompute a complete published
      Data Block from their immutable request and snapshot.

    Flow: normalize source text, run local or remote quotation extraction, preserve
        source-row mappings, and return flat occurrence rows.
    """
    import polars as pl

    from ldaca_wordflow.analysis.quotation_core import (
        flatten_grouped_quotation_dataframe,
        quotation_groups_via_quote_extractor,
    )

    corpus = [str(v) if v is not None else "" for v in node_corpus]
    non_empty_mask = [bool(value.strip()) for value in corpus]
    filtered_corpus = [value for value, keep in zip(corpus, non_empty_mask) if keep]

    source_column_name = "__quotation_source__"
    data: dict[str, list] = {source_column_name: filtered_corpus}
    # `QUOTE_extraction` is the per-quote-row copy of the raw source document
    # text — exposed under a canonical name so callers (Preview and Run All)
    # can refer to it without needing to know the user's source column name.
    # Carry it through extraction so each quote retains its source text. The
    # child worker omits it from the published Data Block when not requested.
    data[QUOTE_EXTRACTION_COLUMN] = filtered_corpus
    selected_columns: list[str] = [QUOTE_EXTRACTION_COLUMN]
    output_columns: list[str] = [QUOTE_EXTRACTION_COLUMN]

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
    if extra_columns_dtypes:
        cast_exprs = [
            pl.col(col).cast(dtype)
            for col, dtype in extra_columns_dtypes.items()
            if col in input_df.columns and input_df.schema[col] != dtype
        ]
        if cast_exprs:
            input_df = input_df.with_columns(cast_exprs)
    quote_df = quotation_groups_via_quote_extractor(input_df, source_column_name)
    quote_df = flatten_grouped_quotation_dataframe(quote_df)
    generated_columns = [
        column_name
        for column_name in QUOTE_COLUMN_NAMES
        if column_name in quote_df.columns
    ]
    quote_df = quote_df.select(selected_columns + generated_columns)

    if QUOTE_QUOTE_COLUMN in quote_df.columns:
        quote_df = quote_df.filter(pl.col(QUOTE_QUOTE_COLUMN).is_not_null())

    return quote_df, output_columns + generated_columns


@process_entrypoint
def run_quotation_run_all(
    artifact_dir: str,
    input_snapshot_dir: str,
    parent_node_id: str,
    document_column: str,
    engine: dict[str, Any],
    quotation_service_max_batch_size: int,
    quotation_service_timeout: float,
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """Compute one complete immutable Quotation Result table."""
    try:
        if progress_callback:
            progress_callback(0.02, "Loading quotation extractor...")

        import asyncio
        import os

        import polars as pl

        from ..analysis.quotation_core import compute_quote_dataframe
        from ..infrastructure.providers.quotation_client import (
            QuotationProviderClient,
            QuotationServiceError,
        )
        from ..models.quotation import QuotationEngineType, ResolvedQuotationEngine
        from .input_snapshots import load_snapshot_node

        logger.info("[Worker %d] Starting quotation Run All", os.getpid())
        source_snapshot = load_snapshot_node(input_snapshot_dir, parent_node_id)

        if progress_callback:
            progress_callback(0.2, "Preparing text data...")
        node_corpus, extra_columns_data, extra_columns_dtypes, source_row_ids = (
            _collect_quotation_source_from_snapshot(
                input_snapshot_dir=input_snapshot_dir,
                node_id=parent_node_id,
                document_column=document_column,
                extra_column_names=None,
                include_all_metadata=True,
            )
        )
        if progress_callback:
            progress_callback(0.6, "Extracting quotations...")

        input_data: dict[str, list] = {
            SOURCE_ROW_ID_COLUMN: source_row_ids,
            document_column: node_corpus,
            QUOTE_EXTRACTION_COLUMN: node_corpus,
        }
        if extra_columns_data:
            input_data.update(extra_columns_data)
        base_df = pl.DataFrame(input_data)
        if extra_columns_dtypes:
            base_df = base_df.with_columns(
                [
                    pl.col(column).cast(dtype)
                    for column, dtype in extra_columns_dtypes.items()
                ]
            )
        snapshot_node = source_snapshot.to_node()
        engine_config = ResolvedQuotationEngine.model_validate(engine)

        async def extract() -> pl.DataFrame:
            async def run_inline(function, *args):
                return function(*args)

            client = (
                QuotationProviderClient(default_timeout=quotation_service_timeout)
                if engine_config.type is QuotationEngineType.REMOTE
                else None
            )

            async def extract_remote(*args, **kwargs):
                if client is None:
                    raise QuotationServiceError(
                        "Remote extraction requested for a local Analysis"
                    )
                return await client.extract(*args, **kwargs)

            try:
                grouped = await compute_quote_dataframe(
                    snapshot_node,
                    base_df,
                    document_column,
                    engine_config,
                    use_base_only=True,
                    extract_remote_fn=extract_remote,
                    run_blocking=run_inline,
                    quotation_service_max_batch_size=(quotation_service_max_batch_size),
                    quotation_service_timeout=quotation_service_timeout,
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
        match_count_value = quote_df.select(
            pl.col("quotation").list.len().sum()
        ).item()
        match_count = int(match_count_value or 0)
        output_columns = list(quote_df.columns)

        if progress_callback:
            progress_callback(0.82, "Serializing quotation Result...")

        result_path = Path(artifact_dir) / "quotation-run-all.parquet"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        quote_df.write_parquet(result_path)

        if progress_callback:
            progress_callback(0.95, "Saving quotation Result...")

        logger.info(
            "[Worker %d] Quotation Run All completed successfully", os.getpid()
        )

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
