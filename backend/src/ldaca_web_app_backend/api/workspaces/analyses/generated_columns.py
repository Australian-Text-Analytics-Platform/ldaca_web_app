"""Canonical generated analysis column names.

Used by:
- concordance, topic-modeling, and quotation analysis routes/workers

Why:
- Keeps generated column naming consistent across live results, detach flows,
  worker artifacts, and frontend-facing payloads.
"""

from __future__ import annotations

import polars as pl

CONC_LEFT_CONTEXT_COLUMN = "CONC_left_context"
CONC_MATCHED_TEXT_COLUMN = "CONC_matched_text"
CONC_RIGHT_CONTEXT_COLUMN = "CONC_right_context"
CONC_START_IDX_COLUMN = "CONC_start_idx"
CONC_END_IDX_COLUMN = "CONC_end_idx"
CONC_L1_COLUMN = "CONC_l1"
CONC_R1_COLUMN = "CONC_r1"

CORE_CONCORDANCE_COLUMNS = (
    CONC_LEFT_CONTEXT_COLUMN,
    CONC_MATCHED_TEXT_COLUMN,
    CONC_RIGHT_CONTEXT_COLUMN,
    CONC_START_IDX_COLUMN,
    CONC_END_IDX_COLUMN,
    CONC_L1_COLUMN,
    CONC_R1_COLUMN,
)


def concordance_struct_projection(struct_column: str) -> tuple[pl.Expr, ...]:
    """Project raw concordance struct fields into canonical prefixed columns."""
    return (
        pl
        .col(struct_column)
        .struct.field("left_context")
        .alias(CONC_LEFT_CONTEXT_COLUMN),
        pl
        .col(struct_column)
        .struct.field("matched_text")
        .alias(CONC_MATCHED_TEXT_COLUMN),
        pl
        .col(struct_column)
        .struct.field("right_context")
        .alias(CONC_RIGHT_CONTEXT_COLUMN),
        pl.col(struct_column).struct.field("start_idx").alias(CONC_START_IDX_COLUMN),
        pl.col(struct_column).struct.field("end_idx").alias(CONC_END_IDX_COLUMN),
        pl.col(struct_column).struct.field("l1").alias(CONC_L1_COLUMN),
        pl.col(struct_column).struct.field("r1").alias(CONC_R1_COLUMN),
    )


TOPIC_COLUMN = "TOPIC_topic"
TOPIC_MEANING_COLUMN = "TOPIC_topic_meaning"

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


def quotation_struct_projection(struct_column: str) -> tuple[pl.Expr, ...]:
    """Project raw quotation struct fields into canonical prefixed columns."""
    return (
        pl.col(struct_column).struct.field("speaker").alias(QUOTE_SPEAKER_COLUMN),
        pl
        .col(struct_column)
        .struct.field("speaker_start_idx")
        .alias(QUOTE_SPEAKER_START_IDX_COLUMN),
        pl
        .col(struct_column)
        .struct.field("speaker_end_idx")
        .alias(QUOTE_SPEAKER_END_IDX_COLUMN),
        pl.col(struct_column).struct.field("quote").alias(QUOTE_QUOTE_COLUMN),
        pl
        .col(struct_column)
        .struct.field("quote_start_idx")
        .alias(QUOTE_QUOTE_START_IDX_COLUMN),
        pl
        .col(struct_column)
        .struct.field("quote_end_idx")
        .alias(QUOTE_QUOTE_END_IDX_COLUMN),
        pl.col(struct_column).struct.field("verb").alias(QUOTE_VERB_COLUMN),
        pl
        .col(struct_column)
        .struct.field("verb_start_idx")
        .alias(QUOTE_VERB_START_IDX_COLUMN),
        pl
        .col(struct_column)
        .struct.field("verb_end_idx")
        .alias(QUOTE_VERB_END_IDX_COLUMN),
        pl.col(struct_column).struct.field("quote_type").alias(QUOTE_TYPE_COLUMN),
        pl
        .col(struct_column)
        .struct.field("quote_token_count")
        .alias(QUOTE_TOKEN_COUNT_COLUMN),
        pl
        .col(struct_column)
        .struct.field("is_floating_quote")
        .alias(QUOTE_IS_FLOATING_COLUMN),
        pl.col(struct_column).struct.field("quote_row_idx").alias(QUOTE_ROW_IDX_COLUMN),
    )
