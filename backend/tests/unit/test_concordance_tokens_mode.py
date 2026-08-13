"""Concordance tokens-mode honors the tokenization column.

- Regex mode (default) walks raw text; ``num_left_tokens`` means "chars" on
  CJK because there's no whitespace.
- Tokens mode walks the tokenization column for exact-token matches with
  N-actual-token context — the segmentation-aware semantics CJK users want.

These tests cover the pure helpers without touching FastAPI; the route
wiring is exercised by the existing concordance regression tests, which
should remain byte-identical since search_mode defaults to "regex".
"""

from __future__ import annotations


import polars as pl
import pytest
from ldaca_wordflow.analysis.concordance_core import (
    compute_node_concordance_page,
)
from ldaca_wordflow.analysis.concordance_tokens import (
    build_token_hit,
    compute_tokens_concordance_page,
    find_token_matches,
    parse_tokens_mode_alternatives,
)
from ldaca_wordflow.analysis.generated_columns import (
    CONC_END_IDX_COLUMN,
    CONC_LEFT_CONTEXT_COLUMN,
    CONC_MATCHED_TEXT_COLUMN,
    CONC_RIGHT_CONTEXT_COLUMN,
    CONC_START_IDX_COLUMN,
)
from ldaca_wordflow.analysis.token_cache import tokenize_lazyframe
from ldaca_wordflow.shared.errors import InvalidInputError

# Toy Chinese document tokenised by lindera:jieba-style segmentation. Offsets are
# char positions in the original text.
ZH_TEXT = "今天天气很好今天我们出去玩"
ZH_TOKENS = [
    {"token": "今天", "start": 0, "end": 2},
    {"token": "天气", "start": 2, "end": 4},
    {"token": "很", "start": 4, "end": 5},
    {"token": "好", "start": 5, "end": 6},
    {"token": "今天", "start": 6, "end": 8},
    {"token": "我们", "start": 8, "end": 10},
    {"token": "出去", "start": 10, "end": 12},
    {"token": "玩", "start": 12, "end": 13},
]


def test_find_token_matches_exact_only() -> None:
    matches = find_token_matches(ZH_TOKENS, "今天", case_sensitive=False)
    assert matches == [0, 4]


def test_find_token_matches_partial_word_is_not_a_substring_match() -> None:
    # Tokens-mode does NOT do substring matching — "今" alone shouldn't hit
    # because no token equals exactly "今".
    assert find_token_matches(ZH_TOKENS, "今", case_sensitive=False) == []


def test_find_token_matches_case_insensitive_default() -> None:
    en_tokens = [
        {"token": "Hello", "start": 0, "end": 5},
        {"token": "world", "start": 6, "end": 11},
        {"token": "HELLO", "start": 12, "end": 17},
    ]
    assert find_token_matches(en_tokens, "hello", case_sensitive=False) == [0, 2]
    assert find_token_matches(en_tokens, "hello", case_sensitive=True) == []


def test_build_token_hit_walks_actual_token_context() -> None:
    hit = build_token_hit(
        ZH_TOKENS,
        match_index=0,
        raw_text=ZH_TEXT,
        num_left=2,
        num_right=2,
    )
    assert hit[CONC_MATCHED_TEXT_COLUMN] == "今天"
    assert hit[CONC_START_IDX_COLUMN] == 0
    assert hit[CONC_END_IDX_COLUMN] == 2
    assert hit[CONC_LEFT_CONTEXT_COLUMN] == ""  # no left tokens at index 0
    assert hit[CONC_RIGHT_CONTEXT_COLUMN] == ZH_TEXT[2:5]  # "天气很"


def test_build_token_hit_second_match_has_two_left_tokens() -> None:
    hit = build_token_hit(
        ZH_TOKENS,
        match_index=4,
        raw_text=ZH_TEXT,
        num_left=2,
        num_right=2,
    )
    # Match is at index 4 ("今天"); left = tokens[2..4] = ["很", "好"]
    # → left_context = ZH_TEXT[tokens[2].start : tokens[4].start] = ZH_TEXT[4:6]
    assert hit[CONC_LEFT_CONTEXT_COLUMN] == ZH_TEXT[4:6]
    assert hit[CONC_RIGHT_CONTEXT_COLUMN] == ZH_TEXT[8:12]  # 2 tokens to the right


def test_compute_tokens_page_groups_hits_per_row() -> None:
    tokenization_col = "tokenization.text.lindera:jieba"
    df = pl.DataFrame(
        {
            "text": [ZH_TEXT, "晚上去看电影", "今天"],
            tokenization_col: [
                ZH_TOKENS,
                [
                    {"token": "晚上", "start": 0, "end": 2},
                    {"token": "去", "start": 2, "end": 3},
                    {"token": "看", "start": 3, "end": 4},
                    {"token": "电影", "start": 4, "end": 6},
                ],
                [{"token": "今天", "start": 0, "end": 2}],
            ],
        }
    ).lazy()

    page = compute_tokens_concordance_page(
        df,
        column="text",
        tokenization_column=tokenization_col,
        request={
            "search_word": "今天",
            "case_sensitive": False,
            "num_left_tokens": 2,
            "num_right_tokens": 2,
        },
        page=1,
        page_size=10,
        sort_by=None,
        descending=False,
    )

    # Two rows have hits (row 0 has 2 hits, row 2 has 1). Row 1 has none.
    assert page["pagination"]["result_count"] == 2
    assert len(page["data"]) == 2
    first_row_hits = page["data"][0]
    assert len(first_row_hits) == 2
    second_row_hits = page["data"][1]
    assert len(second_row_hits) == 1

    # The hydrated token column is stripped from the per-hit projection; only
    # ``text`` and CONC_* fields surface.
    sample_hit = first_row_hits[0]
    assert tokenization_col not in sample_hit
    assert sample_hit[CONC_MATCHED_TEXT_COLUMN] == "今天"


def test_compute_tokens_page_rejects_a_generated_sort_column() -> None:
    tokenization_col = "tokenization.text.native:plain_words_en"
    source = pl.DataFrame(
        {
            "text": ["alpha"],
            tokenization_col: [[{"token": "alpha", "start": 0, "end": 5}]],
        }
    ).lazy()

    with pytest.raises(InvalidInputError, match="Sort column"):
        compute_tokens_concordance_page(
            source,
            column="text",
            tokenization_column=tokenization_col,
            request={"search_word": "alpha"},
            page=1,
            page_size=10,
            sort_by=CONC_MATCHED_TEXT_COLUMN,
            descending=False,
        )


def test_token_mode_hydrates_only_requested_page_slice(tmp_path) -> None:
    cache_file = tmp_path / "tokens.duckdb"
    source = pl.DataFrame(
        {"text": [f"hello {index}" for index in range(5)]}
    ).lazy()
    tokenized, tokenization_col = tokenize_lazyframe(
        data=source,
        source_column="text",
        model="huggingface:bert-base-uncased",
        cache_path=cache_file,
    )

    page = compute_node_concordance_page(
        {
            "lf": tokenized,
            "column": "text",
            "label": "probe",
            "tokenization_column": tokenization_col,
        },
        {
            "search_word": "hello",
            "regex": False,
            "whole_word": False,
            "case_sensitive": False,
            "num_left_tokens": 1,
            "num_right_tokens": 1,
            "search_mode": "tokens",
        },
        page=1,
        page_size=2,
        sort_by=None,
        descending=True,
    )

    # Validate that only the 2 requested page slice rows were tokenized/cached
    import duckdb

    with duckdb.connect(str(cache_file), read_only=True) as conn:
        row = conn.execute("SELECT count(*) FROM token_cache").fetchone()
        assert row is not None
        cached_count = row[0]
    assert cached_count == 2

    assert page["pagination"]["page_size"] == 2
    assert page["pagination"]["total_source_rows"] == 5
    assert page["pagination"]["result_count"] == 2


def test_compute_tokens_page_with_english_word_aware_context() -> None:
    tokenization_col = "tokenization.text.huggingface:bert-base-uncased"
    en_text = "the quick brown fox jumps over the lazy dog"
    en_tokens = []
    cursor = 0
    for tok in en_text.split():
        start = en_text.find(tok, cursor)
        en_tokens.append({"token": tok, "start": start, "end": start + len(tok)})
        cursor = start + len(tok)
    df = pl.DataFrame({"text": [en_text], tokenization_col: [en_tokens]}).lazy()

    page = compute_tokens_concordance_page(
        df,
        column="text",
        tokenization_column=tokenization_col,
        request={
            "search_word": "fox",
            "case_sensitive": False,
            "num_left_tokens": 2,
            "num_right_tokens": 2,
        },
        page=1,
        page_size=10,
        sort_by=None,
        descending=False,
    )

    hit = page["data"][0][0]
    assert hit[CONC_MATCHED_TEXT_COLUMN] == "fox"
    # 2 actual tokens of left context = "brown " + ""? The slice rule keeps
    # the original separators in the raw text — let's check by reconstructing.
    # tokens[1..3] -> "quick brown" → context = en_text[tokens[1].start : tokens[3].start]
    expected_left = en_text[
        int(en_tokens[1]["start"]) : int(en_tokens[3]["start"])
    ]
    expected_right = en_text[
        int(en_tokens[3]["end"]) : int(en_tokens[5]["end"])
    ]
    assert hit[CONC_LEFT_CONTEXT_COLUMN] == expected_left
    assert hit[CONC_RIGHT_CONTEXT_COLUMN] == expected_right


def test_parse_tokens_mode_alternatives_splits_on_pipe_comma_space() -> None:
    """All three delimiters should produce the same alternative set so the
    user can mix them however they're used to (regex-style ``|`` vs
    CSV-style ``,`` vs natural ``space``).
    """
    expected = {"cat", "dog", "fish"}
    assert (
        parse_tokens_mode_alternatives("cat|dog|fish", case_sensitive=False) == expected
    )
    assert (
        parse_tokens_mode_alternatives("cat, dog ,fish", case_sensitive=False)
        == expected
    )
    assert (
        parse_tokens_mode_alternatives("cat dog fish", case_sensitive=False) == expected
    )
    # Mixed separators + collapsed runs.
    assert (
        parse_tokens_mode_alternatives("cat,  dog | fish", case_sensitive=False)
        == expected
    )


def test_parse_tokens_mode_alternatives_drops_empty_pieces() -> None:
    """Stray separators must not produce an empty needle that would match
    nothing-strings everywhere (or, worse, every empty token)."""
    assert parse_tokens_mode_alternatives("|cat||dog,,", case_sensitive=False) == {
        "cat",
        "dog",
    }
    assert parse_tokens_mode_alternatives("   ", case_sensitive=False) == set()
    assert parse_tokens_mode_alternatives("", case_sensitive=False) == set()


def test_parse_tokens_mode_alternatives_casefolds_when_insensitive() -> None:
    assert parse_tokens_mode_alternatives("Cat|DOG", case_sensitive=False) == {
        "cat",
        "dog",
    }
    assert parse_tokens_mode_alternatives("Cat|DOG", case_sensitive=True) == {
        "Cat",
        "DOG",
    }


def test_find_token_matches_handles_multiple_alternatives() -> None:
    """The big-deal change: tokens-mode now supports multi-keyword input."""
    matches = find_token_matches(ZH_TOKENS, "今天|玩", case_sensitive=False)
    # 今天 hits at index 0 and 4; 玩 hits at index 7 — returned in token
    # order regardless of the alternative ordering in the query.
    assert matches == [0, 4, 7]


def test_find_token_matches_alternatives_with_no_hits_returns_empty() -> None:
    # The query parses but none of the alternatives are present.
    assert find_token_matches(ZH_TOKENS, "cat|dog|fish", case_sensitive=False) == []


def test_find_token_matches_empty_query_returns_empty() -> None:
    # Without this guard a bare ``|`` could be parsed as "match anything".
    assert find_token_matches(ZH_TOKENS, "", case_sensitive=False) == []
    assert find_token_matches(ZH_TOKENS, "|", case_sensitive=False) == []
    assert find_token_matches(ZH_TOKENS, " , ", case_sensitive=False) == []
