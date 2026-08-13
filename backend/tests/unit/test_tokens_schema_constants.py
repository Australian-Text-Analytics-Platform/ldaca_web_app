"""Dynamic tokenization column naming and struct-schema contract.

Asserts:
- dynamic token column names are deterministic, and
- ``tokens_struct_dtype()`` lines up with the schema polars-text's
  ``tokenize`` actually emits.

These are the contracts every tokenization consumer relies on, so any drift
between Rust and Python schemas — or between the naming helper and its consumers
— must fail loudly here.
"""

from __future__ import annotations

from typing import Any, cast

import polars as pl
import polars_text  # noqa: F401
from ldaca_wordflow.analysis.generated_columns import (
    TOKENS_END_FIELD,
    TOKENS_START_FIELD,
    TOKENS_TOKEN_FIELD,
    tokenization_column_name,
    tokens_struct_dtype,
    tokens_struct_projection,
)

# Test fixture: canonical (source, model) we use throughout this module.
_TEXT_COLUMN = "text"
_BERT_MODEL = "huggingface:bert-base-uncased"
_TOKENS_NAME = f"tokenization.{_TEXT_COLUMN}.{_BERT_MODEL}"


def test_tokenization_column_name_builds_canonical_label() -> None:
    assert tokenization_column_name(_TEXT_COLUMN, _BERT_MODEL) == _TOKENS_NAME


def test_tokens_struct_dtype_matches_polars_text_output() -> None:
    df = pl.DataFrame({"text": ["Hello world"]})
    out = df.select(
        cast(Any, pl.col("text")).text.tokenize(model=_BERT_MODEL).alias(_TOKENS_NAME)
    )
    assert out.schema[_TOKENS_NAME] == tokens_struct_dtype(), (
        f"polars-text emits {out.schema[_TOKENS_NAME]!r}, "
        f"but generated_columns declares {tokens_struct_dtype()!r}"
    )


def test_tokens_struct_projection_unpacks_fields() -> None:
    df = pl.DataFrame({"text": ["hello world"]})
    tokens_df = df.select(
        cast(Any, pl.col("text")).text.tokenize(model=_BERT_MODEL).alias(_TOKENS_NAME)
    ).explode(_TOKENS_NAME)
    unpacked = tokens_df.select(*tokens_struct_projection(_TOKENS_NAME))
    assert set(unpacked.columns) == {
        TOKENS_TOKEN_FIELD,
        TOKENS_START_FIELD,
        TOKENS_END_FIELD,
    }
    assert unpacked.height > 0
