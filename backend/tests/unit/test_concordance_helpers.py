import polars as pl
import pytest
from ldaca_wordflow.analysis.concordance_core import (
    build_concordance_search_pattern,
    compute_concordance_page,
    concordance_non_empty_expr,
)
from ldaca_wordflow.shared.errors import InvalidInputError


def test_filter_concordance_rows_removes_blank_entries():
    df = pl.DataFrame(
        {
            "CONC_matched_text": ["alpha", None, "   ", ""],
            "CONC_left_context": ["", "", "", ""],
            "CONC_right_context": ["", "context", "\t", None],
        }
    )

    filtered = df.filter(concordance_non_empty_expr())

    assert filtered.height == 2


def test_build_concordance_search_pattern_wraps_whole_word_literals():
    pattern, use_regex = build_concordance_search_pattern(
        "alpha.beta",
        regex=False,
        whole_word=True,
    )

    assert pattern == r"\b(?:alpha\.beta)\b"
    assert use_regex is True


def test_compute_concordance_page_groups_matches_by_source_row():
    request = {
        "search_word": "alpha",
        "num_left_tokens": 2,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": False,
    }
    source = pl.DataFrame(
        {
            "text": ["alpha beta alpha", "gamma alpha"],
            "speaker": ["A", "B"],
        }
    ).lazy()

    result = compute_concordance_page(
        source,
        "text",
        request,
        page=1,
        page_size=1,
        sort_by=None,
        descending=False,
        node_label="node-a",
    )

    assert result["pagination"]["page_size"] == 1
    assert len(result["data"]) == 1

    grouped_row = result["data"][0]
    assert isinstance(grouped_row, list)
    assert len(grouped_row) == 2
    assert all(hit["speaker"] == "A" for hit in grouped_row)
    assert all(hit["__source_node"] == "node-a" for hit in grouped_row)
    assert [hit["CONC_matched_text"] for hit in grouped_row] == ["alpha", "alpha"]


def test_compute_concordance_page_whole_word_ignores_partial_matches():
    request = {
        "search_word": "alpha",
        "num_left_tokens": 2,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": False,
        "whole_word": True,
    }
    source = pl.DataFrame(
        {
            "text": ["alphabet soup", "alpha beta"],
            "speaker": ["A", "B"],
        }
    ).lazy()

    result = compute_concordance_page(
        source,
        "text",
        request,
        page=1,
        page_size=5,
        sort_by=None,
        descending=False,
        node_label="node-a",
    )

    assert len(result["data"]) == 1
    assert result["data"][0][0]["speaker"] == "B"
    assert result["data"][0][0]["CONC_matched_text"] == "alpha"


def test_compute_concordance_page_ignores_punctuation_in_context_counts() -> None:
    request = {
        "search_word": "target",
        "num_left_tokens": 2,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": False,
        "ignore_punctuation": True,
    }
    source = pl.DataFrame(
        {"text": ["alpha one , , , target . . three omega"]}
    ).lazy()

    result = compute_concordance_page(
        source,
        "text",
        request,
        page=1,
        page_size=5,
        sort_by=None,
        descending=False,
    )

    hit = result["data"][0][0]
    assert (
        hit["CONC_left_context"],
        hit["CONC_l1"],
        hit["CONC_right_context"],
        hit["CONC_r1"],
        hit["CONC_extraction"],
    ) == (
        "alpha one , , , ",
        "one",
        " . . three omega",
        "three",
        "alpha one , , , target . . three omega",
    )


def test_compute_concordance_page_rejects_an_unknown_sort_column() -> None:
    source = pl.DataFrame({"text": ["alpha"]}).lazy()

    with pytest.raises(InvalidInputError, match="Sort column"):
        compute_concordance_page(
            source,
            "text",
            {
                "search_word": "alpha",
                "num_left_tokens": 1,
                "num_right_tokens": 1,
                "regex": False,
                "case_sensitive": False,
            },
            page=1,
            page_size=10,
            sort_by="missing",
            descending=False,
        )


def test_compute_concordance_page_rejects_a_generated_sort_column() -> None:
    source = pl.DataFrame({"text": ["alpha"]}).lazy()

    with pytest.raises(InvalidInputError, match="Sort column"):
        compute_concordance_page(
            source,
            "text",
            {
                "search_word": "alpha",
                "num_left_tokens": 1,
                "num_right_tokens": 1,
                "regex": False,
                "case_sensitive": False,
            },
            page=1,
            page_size=10,
            sort_by="CONC_matched_text",
            descending=False,
        )
