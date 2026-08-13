"""Concordance occurrence builders preserve one output shape across modes."""

from __future__ import annotations

import polars as pl
from ldaca_wordflow.analysis.generated_columns import (
    CONC_END_IDX_COLUMN,
    CONC_EXTRACTION_COLUMN,
    CONC_L1_COLUMN,
    CONC_LEFT_CONTEXT_COLUMN,
    CONC_MATCHED_TEXT_COLUMN,
    CONC_R1_COLUMN,
    CONC_RIGHT_CONTEXT_COLUMN,
    CONC_START_IDX_COLUMN,
    CORE_CONCORDANCE_COLUMNS,
)
from ldaca_wordflow.workers.concordance import (
    _build_concordance_occurrence_dataframe,
    _build_tokens_concordance_occurrence_dataframe,
)

_ZH_TOKENS_DOC_A = [
    {"token": "今天", "start": 0, "end": 2},
    {"token": "天气", "start": 2, "end": 4},
    {"token": "很", "start": 4, "end": 5},
    {"token": "好", "start": 5, "end": 6},
    {"token": "今天", "start": 6, "end": 8},
    {"token": "我们", "start": 8, "end": 10},
    {"token": "出去", "start": 10, "end": 12},
    {"token": "玩", "start": 12, "end": 13},
]
_ZH_DOC_A = "今天天气很好今天我们出去玩"
_ZH_TOKENS_DOC_B = [
    {"token": "晚上", "start": 0, "end": 2},
    {"token": "今天", "start": 2, "end": 4},
    {"token": "见面", "start": 4, "end": 6},
]
_ZH_DOC_B = "晚上今天见面"


def test_tokens_builder_emits_same_core_columns_as_regex_builder() -> None:
    """The token builder matches the regex builder's core column order."""
    extras = {"doc_id": ["a", "b"]}
    extras_dtypes = {"doc_id": pl.Utf8}

    tokens_df, tokens_cols = _build_tokens_concordance_occurrence_dataframe(
        node_corpus=[_ZH_DOC_A, _ZH_DOC_B],
        node_tokens=[_ZH_TOKENS_DOC_A, _ZH_TOKENS_DOC_B],
        document_column="text",
        search_word="今天",
        num_left_tokens=2,
        num_right_tokens=2,
        case_sensitive=False,
        include_document_column=True,
        source_row_ids=[0, 1],
        extra_columns_data=extras,
        extra_columns_dtypes=extras_dtypes,
    )

    # Expected order: [source-row identity, document column, *extras,
    # *CORE_CONCORDANCE_COLUMNS, CONC_extraction] — identical to regex builder.
    assert tokens_cols == [
        "__wordflow_source_row_id",
        "text",
        "doc_id",
        *CORE_CONCORDANCE_COLUMNS,
        CONC_EXTRACTION_COLUMN,
    ]
    assert list(tokens_df.columns) == tokens_cols


def test_tokens_builder_finds_exact_token_matches() -> None:
    """Doc A has two 今天 tokens, Doc B has one — so 3 rows total."""
    df, _cols = _build_tokens_concordance_occurrence_dataframe(
        node_corpus=[_ZH_DOC_A, _ZH_DOC_B],
        node_tokens=[_ZH_TOKENS_DOC_A, _ZH_TOKENS_DOC_B],
        document_column="text",
        search_word="今天",
        num_left_tokens=2,
        num_right_tokens=2,
        case_sensitive=False,
        include_document_column=True,
        source_row_ids=[0, 1],
        extra_columns_data=None,
        extra_columns_dtypes=None,
    )
    assert df.height == 3
    assert df.get_column(CONC_MATCHED_TEXT_COLUMN).to_list() == [
        "今天",
        "今天",
        "今天",
    ]


def test_tokens_builder_handles_empty_corpus_gracefully() -> None:
    """No matches → empty df with correct schema so the downstream
    group_by join doesn't choke.
    """
    df, cols = _build_tokens_concordance_occurrence_dataframe(
        node_corpus=[_ZH_DOC_A],
        node_tokens=[_ZH_TOKENS_DOC_A],
        document_column="text",
        search_word="不存在",  # not in any token list
        num_left_tokens=2,
        num_right_tokens=2,
        case_sensitive=False,
        include_document_column=True,
        source_row_ids=[0],
        extra_columns_data=None,
        extra_columns_dtypes=None,
    )
    assert df.height == 0
    assert "text" in df.columns
    for required in (
        CONC_LEFT_CONTEXT_COLUMN,
        CONC_MATCHED_TEXT_COLUMN,
        CONC_RIGHT_CONTEXT_COLUMN,
        CONC_START_IDX_COLUMN,
        CONC_END_IDX_COLUMN,
        CONC_L1_COLUMN,
        CONC_R1_COLUMN,
        CONC_EXTRACTION_COLUMN,
    ):
        assert required in df.columns
    assert cols[-1] == CONC_EXTRACTION_COLUMN


def test_regex_and_tokens_builders_agree_on_english_word_boundary_case() -> None:
    """Sanity check: when tokenisation matches whitespace boundaries
    exactly (i.e. English), tokens-mode and regex-mode whole-word
    searches return the same number of hits. Guards against accidental
    drift between the two builders' counting semantics.
    """
    en_text_a = "the quick brown fox the lazy dog"
    en_text_b = "the cat sat the mat"

    def _tokens(text: str) -> list[dict]:
        out = []
        cursor = 0
        for tok in text.split():
            start = text.find(tok, cursor)
            out.append({"token": tok, "start": start, "end": start + len(tok)})
            cursor = start + len(tok)
        return out

    regex_df, _ = _build_concordance_occurrence_dataframe(
        node_corpus=[en_text_a, en_text_b],
        document_column="text",
        search_word="the",
        num_left_tokens=2,
        num_right_tokens=2,
        regex=False,
        whole_word=True,
        case_sensitive=False,
        include_document_column=True,
        source_row_ids=[0, 1],
        extra_columns_data=None,
        extra_columns_dtypes=None,
    )
    tokens_df, _ = _build_tokens_concordance_occurrence_dataframe(
        node_corpus=[en_text_a, en_text_b],
        node_tokens=[_tokens(en_text_a), _tokens(en_text_b)],
        document_column="text",
        search_word="the",
        num_left_tokens=2,
        num_right_tokens=2,
        case_sensitive=False,
        include_document_column=True,
        source_row_ids=[0, 1],
        extra_columns_data=None,
        extra_columns_dtypes=None,
    )

    # Doc A has 2 "the"s, Doc B has 2 "the"s → 4 total. Both engines
    # must agree on this for English where tokenisation = whitespace
    # splitting.
    assert regex_df.height == tokens_df.height == 4
