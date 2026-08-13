"""Request-owned dynamic tokenization with an explicit per-user cache."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import polars as pl
import polars_text  # noqa: F401

from .generated_columns import tokenization_column_name

TOKENS_CACHE_FILENAME = "tokens.duckdb"
PLAIN_WORDS_EN_MODEL = "native:plain_words_en"
_CASE_FREE_MODELS = frozenset(
    {
        "lindera:jieba",
        "lindera:ja-ipadic",
        "lindera:ja-unidic",
        "lindera:ko-dic",
    }
)


def tokens_cache_path(cache_root: str | Path) -> Path:
    """Return the token-cache file below an explicitly owned cache root."""
    return Path(cache_root) / TOKENS_CACHE_FILENAME


def tokenize_lazyframe(
    *,
    data: pl.LazyFrame,
    source_column: str,
    model: str,
    cache_path: str | Path | None,
) -> tuple[pl.LazyFrame, str]:
    """Attach tokens selected by an immutable Analysis request.

    The native plain-word tokenizer deliberately receives no cache path and
    therefore never opens DuckDB. Every other model requires the caller's
    per-user cache path; polars-text keys entries by model, parameters, and
    content hash.
    """
    normalized_model = model.strip()
    if not normalized_model:
        raise ValueError("Tokenizer model must be non-empty")
    if source_column not in data.collect_schema().names():
        raise KeyError(f"Data Block has no column {source_column!r}")
    if normalized_model != PLAIN_WORDS_EN_MODEL and cache_path is None:
        raise ValueError("Non-plain tokenization requires a cache path")

    tokenization_column = tokenization_column_name(source_column, normalized_model)
    cache: Path | None = None
    if normalized_model != PLAIN_WORDS_EN_MODEL:
        assert cache_path is not None
        cache = Path(cache_path)
    tokenized = data.with_columns(
        cast(Any, pl.col(source_column))
        .text.tokenize(
            lowercase=normalized_model not in _CASE_FREE_MODELS,
            remove_punct=True,
            model=normalized_model,
            cache=cache,
        )
        .alias(tokenization_column)
    )
    return tokenized, tokenization_column


__all__ = [
    "PLAIN_WORDS_EN_MODEL",
    "TOKENS_CACHE_FILENAME",
    "tokenize_lazyframe",
    "tokens_cache_path",
]
