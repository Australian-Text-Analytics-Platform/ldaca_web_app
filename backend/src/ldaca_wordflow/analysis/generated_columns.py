"""Canonical generated column names and projection expressions for Analyses."""

from __future__ import annotations

import polars as pl

CONC_LEFT_CONTEXT_COLUMN = "CONC_left_context"
CONC_MATCHED_TEXT_COLUMN = "CONC_matched_text"
CONC_RIGHT_CONTEXT_COLUMN = "CONC_right_context"
CONC_START_IDX_COLUMN = "CONC_start_idx"
CONC_END_IDX_COLUMN = "CONC_end_idx"
CONC_L1_COLUMN = "CONC_l1"
CONC_R1_COLUMN = "CONC_r1"
CONC_L1_FREQ_COLUMN = "CONC_l1_freq"
CONC_R1_FREQ_COLUMN = "CONC_r1_freq"
# Per-hit raw-window stitch retained in the immutable nested Result. Match
# Data Block Creation may select it directly; Document Data Block Creation normalizes and
# joins the surviving values after applying the Review filter.
CONC_EXTRACTION_COLUMN = "CONC_extraction"

CORE_CONCORDANCE_COLUMNS = (
    CONC_LEFT_CONTEXT_COLUMN,
    CONC_MATCHED_TEXT_COLUMN,
    CONC_RIGHT_CONTEXT_COLUMN,
    CONC_START_IDX_COLUMN,
    CONC_END_IDX_COLUMN,
    CONC_L1_COLUMN,
    CONC_R1_COLUMN,
)

CONCORDANCE_DATA_BLOCK_CREATION_COLUMNS = CORE_CONCORDANCE_COLUMNS + (
    CONC_L1_FREQ_COLUMN,
    CONC_R1_FREQ_COLUMN,
)


def concordance_extraction_expr(
    document_column: str,
) -> pl.Expr:
    """Polars expression that slices the raw KWIC window from ``document_column``.

    Goes from the start of ``CONC_left_context`` to the end of
    ``CONC_right_context`` so the extract preserves the original whitespace
    and punctuation between the context tokens and the matched span.
    Offset-sliced contexts include every separator adjacent to the matched span,
    so their lengths can be applied directly to the match offsets.

    Requires the input frame to carry ``CONC_left_context``,
    ``CONC_right_context``, ``CONC_start_idx``, ``CONC_end_idx``, and the
    named ``document_column``.

    """
    left_len = pl.col(CONC_LEFT_CONTEXT_COLUMN).fill_null("").str.len_chars()
    right_len = pl.col(CONC_RIGHT_CONTEXT_COLUMN).fill_null("").str.len_chars()
    window_start = pl.max_horizontal(
        pl.lit(0, dtype=pl.Int64),
        pl.col(CONC_START_IDX_COLUMN) - left_len,
    )
    window_end = pl.col(CONC_END_IDX_COLUMN) + right_len
    return (
        pl.col(document_column)
        .cast(pl.Utf8, strict=False)
        .str.slice(window_start, window_end - window_start)
        .alias(CONC_EXTRACTION_COLUMN)
    )


def compute_concordance_extraction_string(
    *,
    document_text: str,
    left_context: str | None,
    right_context: str | None,
    start_idx: int,
    end_idx: int,
) -> str:
    """Python equivalent of ``concordance_extraction_expr`` for one hit.

    Used by the live (non-materialised) per-page response builder where each
    hit is projected row-by-row from a struct list rather than batched
    through Polars expressions.

    """
    left = left_context or ""
    right = right_context or ""
    window_start = max(0, int(start_idx) - len(left))
    window_end = int(end_idx) + len(right)
    return (document_text or "")[window_start:window_end]


def concordance_struct_projection(struct_column: str) -> tuple[pl.Expr, ...]:
    """Project raw concordance struct fields into canonical prefixed columns."""
    return (
        pl.col(struct_column)
        .struct.field("left_context")
        .alias(CONC_LEFT_CONTEXT_COLUMN),
        pl.col(struct_column)
        .struct.field("matched_text")
        .alias(CONC_MATCHED_TEXT_COLUMN),
        pl.col(struct_column)
        .struct.field("right_context")
        .alias(CONC_RIGHT_CONTEXT_COLUMN),
        pl.col(struct_column).struct.field("start_idx").alias(CONC_START_IDX_COLUMN),
        pl.col(struct_column).struct.field("end_idx").alias(CONC_END_IDX_COLUMN),
        pl.col(struct_column).struct.field("l1").alias(CONC_L1_COLUMN),
        pl.col(struct_column).struct.field("r1").alias(CONC_R1_COLUMN),
    )


TOPIC_COLUMN = "TOPIC_topic"
TOPIC_MEANING_COLUMN = "TOPIC_topic_meaning"
# Internal-only column on the per-node assignment parquet holding each row's
# Topic Coverage (list of {topic_id, coverage}). Used by the Data Block Creation
# coverage filter; never projected into an output Data Block.
TOPIC_COVERAGE_COLUMN = "TOPIC_topic_coverage"
# User-facing output column names: the dominant ("top 1") topic id and
# full Topic Coverage (rendered as a source-coverage bar).
TOPIC_TOP1_COLUMN = "TOPIC_top1"
TOPIC_COVERAGE_OUTPUT_COLUMN = "TOPIC_coverage"

QUOTE_EXTRACTION_COLUMN = "QUOTE_extraction"
QUOTE_SPEAKER_COLUMN = "QUOTE_speaker"
QUOTE_SPEAKER_START_IDX_COLUMN = "QUOTE_speaker_start_idx"
QUOTE_SPEAKER_END_IDX_COLUMN = "QUOTE_speaker_end_idx"
QUOTE_QUOTE_COLUMN = "QUOTE_quote"
QUOTE_QUOTE_START_IDX_COLUMN = "QUOTE_quote_start_idx"
QUOTE_QUOTE_END_IDX_COLUMN = "QUOTE_quote_end_idx"
QUOTE_VERB_COLUMN = "QUOTE_verb"
QUOTE_VERB_START_IDX_COLUMN = "QUOTE_verb_start_idx"
QUOTE_VERB_END_IDX_COLUMN = "QUOTE_verb_end_idx"
QUOTE_TYPE_COLUMN = "QUOTE_quote_type"
QUOTE_TOKEN_COUNT_COLUMN = "QUOTE_quote_token_count"
QUOTE_IS_FLOATING_COLUMN = "QUOTE_is_floating_quote"
QUOTE_ROW_IDX_COLUMN = "QUOTE_quote_row_idx"

QUOTE_COLUMN_NAMES = (
    QUOTE_SPEAKER_COLUMN,
    QUOTE_SPEAKER_START_IDX_COLUMN,
    QUOTE_SPEAKER_END_IDX_COLUMN,
    QUOTE_QUOTE_COLUMN,
    QUOTE_QUOTE_START_IDX_COLUMN,
    QUOTE_QUOTE_END_IDX_COLUMN,
    QUOTE_VERB_COLUMN,
    QUOTE_VERB_START_IDX_COLUMN,
    QUOTE_VERB_END_IDX_COLUMN,
    QUOTE_TYPE_COLUMN,
    QUOTE_TOKEN_COUNT_COLUMN,
    QUOTE_IS_FLOATING_COLUMN,
    QUOTE_ROW_IDX_COLUMN,
)


# ----------------------------------------------------------------------------
# Dynamic tokenization columns
# ----------------------------------------------------------------------------
# Token outputs are addressed only when an Analysis request hydrates them into
# a temporary LazyFrame. The physical token column is never stored on a Data
# Block.

TOKENIZATION_SEPARATOR = "."

TOKENS_COLUMN_MARKER = "tokenization"
TOKENS_TOKEN_FIELD = "token"
TOKENS_START_FIELD = "start"
TOKENS_END_FIELD = "end"


def tokenization_column_name(source_column: str, model: str) -> str:
    """Build the temporary tokenization column name for ``(source, model)``.

    Example: ``tokenization_column_name("text", "lindera:jieba")`` returns
    ``"tokenization.text.lindera:jieba"``. The name is used only when dynamically
    hydrating a LazyFrame for token-aware analyses.

    """
    return TOKENIZATION_SEPARATOR.join((TOKENS_COLUMN_MARKER, source_column, model))


def tokens_struct_dtype() -> pl.DataType:
    """The canonical Polars dtype for a tokens-with-offsets column.

    ``List[Struct{token: String, start: Int64, end: Int64}]`` — must match
    the Rust output type emitted by ``polars_text::expressions::
    list_token_struct_output``. Tests assert schema equality, so keep these
    two definitions in sync.

    """
    return pl.List(
        pl.Struct(
            [
                pl.Field(TOKENS_TOKEN_FIELD, pl.String),
                pl.Field(TOKENS_START_FIELD, pl.Int64),
                pl.Field(TOKENS_END_FIELD, pl.Int64),
            ]
        )
    )


def tokens_struct_projection(struct_column: str) -> tuple[pl.Expr, ...]:
    """Project the struct fields out of a tokens row (list-of-struct).

    Returns expressions that, applied after ``.explode(struct_column)``,
    flatten each token into separate ``token`` / ``start`` / ``end``
    columns. Useful for ad-hoc inspection; production token-consuming
    paths typically operate on the list-of-struct directly.

    """
    return (
        pl.col(struct_column)
        .struct.field(TOKENS_TOKEN_FIELD)
        .alias(TOKENS_TOKEN_FIELD),
        pl.col(struct_column)
        .struct.field(TOKENS_START_FIELD)
        .alias(TOKENS_START_FIELD),
        pl.col(struct_column).struct.field(TOKENS_END_FIELD).alias(TOKENS_END_FIELD),
    )
