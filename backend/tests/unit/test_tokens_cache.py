"""Request-owned dynamic tokenization and per-user cache tests."""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import duckdb
import polars as pl
import polars_text  # noqa: F401
import pytest
from ldaca_wordflow.analysis.generated_columns import tokenization_column_name
from ldaca_wordflow.analysis import token_cache as tc

TEST_USER = "test_user"


@pytest.fixture(autouse=True)
def isolated_cache_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    db_path = tmp_path / "tokens.duckdb"
    monkeypatch.setattr(tc, "tokens_cache_path", lambda _user_id: db_path)
    return db_path


def test_cache_schema_has_six_columns(isolated_cache_db: Path) -> None:
    base = pl.DataFrame({"text": ["hello world"]}).lazy()
    expr = cast(Any, pl.col("text")).text.tokenize(
        model="huggingface:bert-base-uncased",
        lowercase=True,
        remove_punct=True,
        cache=tc.tokens_cache_path(TEST_USER),
    )
    base.with_columns(expr.alias("tokens")).collect()

    assert isolated_cache_db.exists()

    with duckdb.connect(str(isolated_cache_db), read_only=True) as conn:
        rows = conn.execute("DESCRIBE token_cache").fetchall()

    assert [row[0] for row in rows] == [
        "model",
        "params_hash",
        "content_hash",
        "tokens",
        "start_offsets",
        "end_offsets",
    ]


def test_non_plain_dynamic_tokenization_uses_cache_without_mutating_source(
    isolated_cache_db: Path,
) -> None:
    source = pl.DataFrame({"text": ["hello world", "hello again"]}).lazy()
    tokenized, tokenization_name = tc.tokenize_lazyframe(
        data=source,
        source_column="text",
        model="huggingface:bert-base-uncased",
        cache_path=isolated_cache_db,
    )
    tokenized_df = tokenized.collect()

    assert tokenization_name == tokenization_column_name(
        "text", "huggingface:bert-base-uncased"
    )
    assert tokenization_name in tokenized_df.columns
    assert tokenization_name not in source.collect_schema().names()
    assert isolated_cache_db.is_file()
    first_tokens = tokenized_df.to_dicts()[0][tokenization_name]
    assert isinstance(first_tokens, list) and first_tokens
    assert first_tokens[0]["token"]


def test_plain_model_bypasses_duckdb_cache(isolated_cache_db: Path) -> None:
    source = pl.DataFrame({"text": ["Hello, world!"]}).lazy()

    tokenized, tokenization_name = tc.tokenize_lazyframe(
        data=source,
        source_column="text",
        model=tc.PLAIN_WORDS_EN_MODEL,
        cache_path=isolated_cache_db,
    )
    collected = tokenized.collect()

    assert collected.get_column(tokenization_name).to_list()[0]
    assert not isolated_cache_db.exists()


def test_non_plain_model_requires_cache_path() -> None:
    with pytest.raises(ValueError, match="requires a cache path"):
        tc.tokenize_lazyframe(
            data=pl.DataFrame({"text": ["hello"]}).lazy(),
            source_column="text",
            model="huggingface:bert-base-uncased",
            cache_path=None,
        )


def test_dynamic_tokenization_rejects_missing_source_column(tmp_path: Path) -> None:
    with pytest.raises(KeyError, match="missing"):
        tc.tokenize_lazyframe(
            data=pl.DataFrame({"text": ["hello"]}).lazy(),
            source_column="missing",
            model="huggingface:bert-base-uncased",
            cache_path=tmp_path / "tokens.duckdb",
        )
