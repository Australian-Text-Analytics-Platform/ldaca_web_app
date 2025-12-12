import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces.analyses.concordance import (
    _filter_concordance_rows,
    _normalize_saved_request,
    _paginate_dataframe,
    _sanitize_request_for_storage,
)


@pytest.mark.parametrize(
    "raw_request",
    [
        {
            "node_ids": ["node-1"],
            "node_columns": {"node-1": "text"},
            "search_word": "example",
            "page": 3,
            "page_size": 25,
            "sort_by": "document_idx",
            "sort_order": "desc",
            "pagination": {"page": 3},
            "regex": False,
            "case_sensitive": None,
        }
    ],
)
def test_sanitize_request_excludes_pagination_keys(raw_request):
    sanitized = _sanitize_request_for_storage(raw_request)

    assert sanitized == {
        "node_ids": ["node-1"],
        "node_columns": {"node-1": "text"},
        "search_word": "example",
        "regex": False,
    }
    for excluded in ("page", "page_size", "sort_by", "sort_order", "pagination"):
        assert excluded not in sanitized


def test_normalize_saved_request_coerces_legacy_shape():
    # We no longer support legacy request formats. Requests must include
    # `node_ids` and `node_columns`.
    raw_request = {
        "node_id": "node-legacy",
        "column": "text",
        "search_word": "alpha",
    }

    assert _normalize_saved_request(raw_request) is None


def test_filter_concordance_rows_removes_blank_entries():
    df = pl.DataFrame({
        "document_idx": [0, 1, 2, 3],
        "matched_text": ["alpha", None, "   ", ""],
        "left_context": ["", "", "", ""],
        "right_context": ["", "context", "\t", None],
    })

    filtered = _filter_concordance_rows(df)

    assert filtered.height == 2
    assert filtered["document_idx"].to_list() == [0, 1]


def test_paginate_dataframe_excludes_empty_rows():
    df = pl.DataFrame({
        "document_idx": [0, 1, 2],
        "matched_text": ["alpha", "   ", "beta"],
        "left_context": ["", "", "foo"],
        "right_context": ["", "", "bar"],
    })

    payload = _paginate_dataframe(
        df, page=1, page_size=10, sort_by=None, sort_order="asc"
    )

    assert payload["total_matches"] == 2
    assert len(payload["data"]) == 2
    assert [row["matched_text"] for row in payload["data"]] == ["alpha", "beta"]
