"""Process-worker implementations for concordance Analysis execution.

Used by:
- canonical Analysis execution and backend tests that exercise concordance
  computation from immutable inputs.

Flow: load text or token inputs, derive concordance rows or dispersion bins, persist
    Parquet Artifacts, and return the owning Analysis result payload.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, cast
from collections.abc import Callable

from ..analysis.concordance_core import build_concordance_search_pattern
from ..analysis.concordance_tokens import (
    build_token_hit,
    find_token_matches,
)
from ..analysis.generated_columns import (
    CONC_END_IDX_COLUMN,
    CONC_EXTRACTION_COLUMN,
    CONC_L1_COLUMN,
    CONC_L1_FREQ_COLUMN,
    CONC_LEFT_CONTEXT_COLUMN,
    CONC_MATCHED_TEXT_COLUMN,
    CONC_R1_COLUMN,
    CONC_R1_FREQ_COLUMN,
    CONC_RIGHT_CONTEXT_COLUMN,
    CONC_START_IDX_COLUMN,
    CORE_CONCORDANCE_COLUMNS,
    CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS,
    concordance_extraction_expr,
    concordance_struct_projection,
)
from .utils import process_entrypoint

# Run All reuses `CONC_extraction` as the source-window column name
# for the per-document multi-line joined string. It carries the same KWIC
# windows as the per-hit `CONC_extraction` column, collapsed into one row per
# source document.
DISPERSION_EXTRACTED_CONTENTS_COLUMN = CONC_EXTRACTION_COLUMN
SOURCE_ROW_ID_COLUMN = "__wordflow_source_row_id"

logger = logging.getLogger(__name__)


def _source_text_filter(document_column: str):
    """Return the non-empty document filter used by concordance workers.

    Called by:
    - root and child concordance Analysis workers using immutable LazyFrame-plan
      snapshots instead of pre-collected corpora.
    """

    import polars as pl

    return (
        pl.col(document_column)
        .cast(pl.Utf8, strict=False)
        .str.strip_chars()
        .str.len_chars()
        .fill_null(0)
        > 0
    )


def _collect_source_input_from_snapshot(
    *,
    input_snapshot_dir: str,
    node_id: str,
    document_column: str,
    token_cache_path: str | None,
    extra_column_names: list[str] | None,
    include_all_metadata: bool = False,
    search_mode: str = "regex",
    tokenizer_model: str | None = None,
) -> tuple[
    list[str],
    dict[str, list] | None,
    dict[str, Any] | None,
    list[Any] | None,
    list[int],
]:
    """Collect concordance source inputs inside the worker process.

    Used by:
    - root and child concordance Analysis workers that receive immutable input
      snapshots.

    Flow:
    1. Load the snapshotted LazyFrame plan for ``node_id``.
    2. Tokenize from the immutable request for tokens-mode searches.
    3. Select/filter the document and requested metadata columns.
    4. Materialize the aligned Python lists only inside the fresh child process.
    """

    import polars as pl

    from .input_snapshots import load_snapshot_node

    snapshot_node = load_snapshot_node(input_snapshot_dir, node_id)
    node_data = snapshot_node.data
    tokenization_column: str | None = None
    if search_mode == "tokens":
        if tokenizer_model is None:
            raise ValueError("Tokens-mode concordance requires a tokenizer model")
        from ..analysis.token_cache import tokenize_lazyframe

        node_data, tokenization_column = tokenize_lazyframe(
            data=node_data,
            source_column=document_column,
            model=tokenizer_model,
            cache_path=token_cache_path,
        )

    schema_names = list(node_data.collect_schema().names())
    if SOURCE_ROW_ID_COLUMN in schema_names:
        raise ValueError(f"Source column name is reserved: {SOURCE_ROW_ID_COLUMN}")
    node_data = node_data.with_row_index(SOURCE_ROW_ID_COLUMN)
    if include_all_metadata:
        metadata_columns = [
            column
            for column in schema_names
            if column != document_column and column != tokenization_column
        ]
    else:
        metadata_columns = list(extra_column_names or [])

    select_exprs = [
        pl.col(SOURCE_ROW_ID_COLUMN),
        pl.col(document_column),
        *[pl.col(c) for c in metadata_columns],
    ]
    if tokenization_column is not None:
        select_exprs.append(pl.col(tokenization_column))

    corpus_df = (
        node_data.select(select_exprs)
        .filter(_source_text_filter(document_column))
        .collect()
    )
    node_corpus = [
        str(value) if value is not None else ""
        for value in corpus_df.get_column(document_column).to_list()
    ]

    extra_columns_data: dict[str, list] | None = None
    extra_columns_dtypes: dict[str, Any] | None = None
    if metadata_columns:
        extra_columns_data = {}
        extra_columns_dtypes = {}
        for column in metadata_columns:
            series = corpus_df.get_column(column)
            extra_columns_data[column] = series.to_list()
            extra_columns_dtypes[column] = series.dtype

    node_tokens = (
        corpus_df.get_column(tokenization_column).to_list()
        if tokenization_column is not None
        else None
    )
    source_row_ids = [
        int(value)
        for value in corpus_df.get_column(SOURCE_ROW_ID_COLUMN).to_list()
    ]
    return (
        node_corpus,
        extra_columns_data,
        extra_columns_dtypes,
        node_tokens,
        source_row_ids,
    )


def _build_concordance_occurrence_dataframe(
    node_corpus: list[str],
    document_column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    whole_word: bool,
    case_sensitive: bool,
    include_document_column: bool,
    source_row_ids: list[int],
    extra_columns_data: dict[str, list] | None,
    extra_columns_dtypes: dict[str, Any] | None = None,
    ignore_punctuation: bool = False,
):
    """Compute flattened occurrence rows for one corpus. Returns (df, output_columns).

    Called by:
    - Concordance Run All Supporting Analyses that compute one complete
      immutable nested Result from their request-owned snapshot.

    Flow: normalize aligned input rows, derive concordance occurrences, and
        return the frame and exact output-column order.
    """
    import polars as pl
    import polars_text as pt

    corpus = [str(v) if v is not None else "" for v in node_corpus]
    non_empty_mask = [bool(v.strip()) for v in corpus]
    corpus = [v for v, keep in zip(corpus, non_empty_mask, strict=False) if keep]

    source_column_name = "__concordance_source__"
    filtered_source_row_ids = [
        value for value, keep in zip(source_row_ids, non_empty_mask, strict=False) if keep
    ]
    data: dict[str, list] = {
        source_column_name: corpus,
        SOURCE_ROW_ID_COLUMN: filtered_source_row_ids,
    }
    base_columns: list[pl.Expr] = [pl.col(SOURCE_ROW_ID_COLUMN)]
    output_columns: list[str] = [SOURCE_ROW_ID_COLUMN]

    if include_document_column:
        data[document_column] = corpus
        base_columns.append(pl.col(document_column))
        output_columns.append(document_column)

    if extra_columns_data:
        for col_name, col_values in extra_columns_data.items():
            filtered = [v for v, keep in zip(col_values, non_empty_mask, strict=False) if keep]
            data[col_name] = filtered
            base_columns.append(pl.col(col_name))
            output_columns.append(col_name)

    df = pl.DataFrame(data)
    if extra_columns_dtypes:
        cast_exprs = [
            pl.col(col).cast(dtype)
            for col, dtype in extra_columns_dtypes.items()
            if col in df.columns and df.schema[col] != dtype
        ]
        if cast_exprs:
            df = df.with_columns(cast_exprs)
    search_pattern, use_regex = build_concordance_search_pattern(
        search_word,
        regex=regex,
        whole_word=whole_word,
    )
    result = (
        df.select(
            [
                pl.col(source_column_name).alias("__concordance_doc__"),
                *base_columns,
                pt.concordance(
                    pl.col(source_column_name),
                    search_pattern,
                    num_left_tokens=num_left_tokens,
                    num_right_tokens=num_right_tokens,
                    regex=use_regex,
                    case_sensitive=case_sensitive,
                    remove_punct=ignore_punctuation,
                ).alias("concordance"),
            ]
        )
        .explode("concordance")
        .select(
            [
                pl.exclude("concordance"),
                *concordance_struct_projection("concordance"),
            ]
        )
        .filter(pl.col(CONC_MATCHED_TEXT_COLUMN).is_not_null())
        .with_columns(
            concordance_extraction_expr(
                "__concordance_doc__",
                contexts_include_separators=ignore_punctuation,
            )
        )
        .drop("__concordance_doc__")
    )
    return result, output_columns + list(CORE_CONCORDANCE_COLUMNS) + [
        CONC_EXTRACTION_COLUMN
    ]


def _build_tokens_concordance_occurrence_dataframe(
    node_corpus: list[str],
    node_tokens: list[Any],
    document_column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    case_sensitive: bool,
    include_document_column: bool,
    source_row_ids: list[int],
    extra_columns_data: dict[str, list] | None,
    extra_columns_dtypes: dict[str, Any] | None = None,
):
    """Tokens-mode parallel of :func:`_build_concordance_occurrence_dataframe`.

    Output column shape is identical to the regex-mode build so paginated
    reads, Run All, and dispersion bin fetches don't have to branch on the
    parquet's origin. Walks ``node_tokens`` (the dynamically hydrated token
    column for the registered source/model) for exact token equality with
    ``search_word``, then reuses
    :func:`build_token_hit` to construct each row.

    Called by:
    - token-mode Concordance Run All Supporting Analyses.

    Flow: align token hits with source rows and return the same occurrence
        shape as regex-mode concordance.
    """
    import polars as pl

    corpus = [str(v) if v is not None else "" for v in node_corpus]
    tokens_per_row = list(node_tokens or [])
    if len(tokens_per_row) != len(corpus):
        raise ValueError(
            "node_tokens length must equal node_corpus length "
            f"(got {len(tokens_per_row)} vs {len(corpus)})"
        )
    # Mirror the regex builder's empty-row filter so the document index
    # stays aligned with extra columns.
    keep_mask = [bool(text.strip()) for text in corpus]
    corpus = [text for text, keep in zip(corpus, keep_mask, strict=False) if keep]
    tokens_per_row = [tokens for tokens, keep in zip(tokens_per_row, keep_mask, strict=False) if keep]
    filtered_source_row_ids = [
        value for value, keep in zip(source_row_ids, keep_mask, strict=False) if keep
    ]

    filtered_extras: dict[str, list] = {}
    if extra_columns_data:
        for col_name, col_values in extra_columns_data.items():
            filtered_extras[col_name] = [
                v for v, keep in zip(col_values, keep_mask, strict=False) if keep
            ]

    hits: list[dict[str, Any]] = []
    for row_index, (raw_text, tokens) in enumerate(zip(corpus, tokens_per_row, strict=False)):
        if not isinstance(tokens, list) or not tokens:
            continue
        # ``tokens`` may include None entries (polars struct nulls). The
        # helpers below tolerate that, so no extra filtering needed here.
        token_list = cast(list[Any], tokens)
        match_indices = find_token_matches(
            token_list, search_word, case_sensitive=case_sensitive
        )
        for match_index in match_indices:
            hit = build_token_hit(
                cast(list[dict[str, Any]], token_list),
                match_index,
                raw_text=raw_text,
                num_left=num_left_tokens,
                num_right=num_right_tokens,
            )
            full: dict[str, Any] = dict(hit)
            full[SOURCE_ROW_ID_COLUMN] = filtered_source_row_ids[row_index]
            if include_document_column:
                full[document_column] = raw_text
            for col_name, values in filtered_extras.items():
                full[col_name] = values[row_index]
            hits.append(full)

    # Build the output columns list in the same order the regex builder
    # uses: [document_column?, *extras, *CORE_CONCORDANCE_COLUMNS,
    # CONC_extraction]. The DataFrame constructor will follow this order
    # because we pass dicts; force the column order explicitly via select
    # at the end so downstream consumers see byte-identical schema.
    output_columns: list[str] = [SOURCE_ROW_ID_COLUMN]
    if include_document_column:
        output_columns.append(document_column)
    output_columns.extend(filtered_extras.keys())
    output_columns.extend(CORE_CONCORDANCE_COLUMNS)
    output_columns.append(CONC_EXTRACTION_COLUMN)

    if not hits:
        # Build an empty DataFrame with the right schema so the downstream
        # group_by joins don't error on an empty input.
        schema: dict[str, Any] = {SOURCE_ROW_ID_COLUMN: pl.UInt32}
        if include_document_column:
            schema[document_column] = pl.Utf8
        if extra_columns_dtypes:
            for col_name in filtered_extras:
                schema[col_name] = extra_columns_dtypes.get(col_name, pl.Utf8)
        else:
            for col_name in filtered_extras:
                schema[col_name] = pl.Utf8
        schema[CONC_LEFT_CONTEXT_COLUMN] = pl.Utf8
        schema[CONC_MATCHED_TEXT_COLUMN] = pl.Utf8
        schema[CONC_RIGHT_CONTEXT_COLUMN] = pl.Utf8
        schema[CONC_START_IDX_COLUMN] = pl.Int64
        schema[CONC_END_IDX_COLUMN] = pl.Int64
        schema[CONC_L1_COLUMN] = pl.Utf8
        schema[CONC_R1_COLUMN] = pl.Utf8
        schema[CONC_EXTRACTION_COLUMN] = pl.Utf8
        return pl.DataFrame(schema=schema), output_columns

    df = pl.DataFrame(hits)
    # Cast extras to the source dtypes if provided, mirroring the regex
    # builder's behaviour. CONC_* numeric columns come out as Int64 from
    # the build_token_hit dicts, which matches the regex side.
    if extra_columns_dtypes:
        cast_exprs = [
            pl.col(col).cast(dtype)
            for col, dtype in extra_columns_dtypes.items()
            if col in df.columns and df.schema[col] != dtype
        ]
        if cast_exprs:
            df = df.with_columns(cast_exprs)
    df = df.select(output_columns)
    return df, output_columns


@process_entrypoint
def run_concordance_run_all(
    artifact_dir: str,
    input_snapshot_dir: str,
    parent_node_id: str,
    document_column: str,
    search_word: str,
    num_left_tokens: int,
    num_right_tokens: int,
    regex: bool,
    whole_word: bool,
    case_sensitive: bool,
    ignore_punctuation: bool = False,
    search_mode: str = "regex",
    tokenizer_model: str | None = None,
    token_cache_path: str | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """Compute one complete immutable Concordance Result table."""
    try:
        if progress_callback:
            progress_callback(0.02, "Loading concordance libraries...")

        import os

        import polars as pl

        from .input_snapshots import load_snapshot_node

        logger.info("[Worker %d] Starting concordance Run All", os.getpid())
        snapshot_node = load_snapshot_node(input_snapshot_dir, parent_node_id)

        if progress_callback:
            progress_callback(0.2, "Preparing text data...")

        (
            node_corpus,
            extra_columns_data,
            extra_columns_dtypes,
            node_tokens,
            source_row_ids,
        ) = _collect_source_input_from_snapshot(
            input_snapshot_dir=input_snapshot_dir,
            node_id=parent_node_id,
            document_column=document_column,
            token_cache_path=token_cache_path,
            extra_column_names=None,
            include_all_metadata=True,
            search_mode=search_mode,
            tokenizer_model=tokenizer_model,
        )

        if progress_callback:
            progress_callback(0.55, "Generating concordance matches...")

        if search_mode == "tokens":
            if node_tokens is None:
                raise ValueError("Token-mode concordance input is unavailable")
            result, output_columns = _build_tokens_concordance_occurrence_dataframe(
                node_corpus=node_corpus,
                node_tokens=node_tokens,
                document_column=document_column,
                search_word=search_word,
                num_left_tokens=num_left_tokens,
                num_right_tokens=num_right_tokens,
                case_sensitive=case_sensitive,
                include_document_column=True,
                source_row_ids=source_row_ids,
                extra_columns_data=extra_columns_data,
                extra_columns_dtypes=extra_columns_dtypes,
            )
        else:
            result, output_columns = _build_concordance_occurrence_dataframe(
                node_corpus=node_corpus,
                document_column=document_column,
                search_word=search_word,
                num_left_tokens=num_left_tokens,
                num_right_tokens=num_right_tokens,
                regex=regex,
                whole_word=whole_word,
                case_sensitive=case_sensitive,
                ignore_punctuation=ignore_punctuation,
                include_document_column=True,
                source_row_ids=source_row_ids,
                extra_columns_data=extra_columns_data,
                extra_columns_dtypes=extra_columns_dtypes,
            )

        l1_freq = (
            result.group_by(CONC_L1_COLUMN)
            .len()
            .rename({"len": CONC_L1_FREQ_COLUMN})
        )
        r1_freq = (
            result.group_by(CONC_R1_COLUMN)
            .len()
            .rename({"len": CONC_R1_FREQ_COLUMN})
        )
        result = result.join(l1_freq, on=CONC_L1_COLUMN, how="left").join(
            r1_freq, on=CONC_R1_COLUMN, how="left"
        )
        output_columns = output_columns + [CONC_L1_FREQ_COLUMN, CONC_R1_FREQ_COLUMN]
        result = result.sort([SOURCE_ROW_ID_COLUMN, CONC_START_IDX_COLUMN])
        match_count = result.height
        source_document_count = len(node_corpus)
        source_columns = [
            column
            for column in output_columns
            if column
            not in {
                *CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS,
                CONC_EXTRACTION_COLUMN,
            }
        ]
        analysis_columns = [
            *CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS,
            CONC_EXTRACTION_COLUMN,
        ]
        result = result.group_by(SOURCE_ROW_ID_COLUMN, maintain_order=True).agg(
            *[
                pl.col(column).first()
                for column in source_columns
                if column != SOURCE_ROW_ID_COLUMN
            ],
            pl.struct(analysis_columns).alias("concordance"),
        )

        if progress_callback:
            progress_callback(0.82, "Serializing concordance Result...")

        result_path = Path(artifact_dir) / "concordance-run-all.parquet"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result.write_parquet(result_path)

        if progress_callback:
            progress_callback(0.95, "Saving concordance Result...")

        logger.info(
            "[Worker %d] Concordance Run All completed successfully", os.getpid()
        )

        return {
            "state": "successful",
            "result_type": "source",
            "source": {
                "node_id": parent_node_id,
                "node_name": snapshot_node.name,
                "color": snapshot_node.color,
                "document_column": document_column,
                "metadata_columns": [
                    column
                    for column in output_columns
                    if column
                    not in {
                        SOURCE_ROW_ID_COLUMN,
                        document_column,
                        *CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS,
                        CONC_EXTRACTION_COLUMN,
                    }
                ],
                "analysis_columns": analysis_columns,
                "internal_columns": [SOURCE_ROW_ID_COLUMN],
                "table": {
                    "table_id": "concordance-run-all",
                    "artifact": str(result_path),
                    "supports_density": True,
                },
                "source_document_count": source_document_count,
                "document_count": result.height,
                "match_count": match_count,
            },
            "message": "Concordance Run All completed successfully",
        }
    except Exception:
        logger.exception("Concordance Run All failed")
        raise
