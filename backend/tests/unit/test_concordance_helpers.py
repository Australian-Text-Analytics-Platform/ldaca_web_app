import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces.analyses.concordance_core import (
    CORE_CONCORDANCE_COLUMNS,
    concordance_non_empty_expr,
    normalize_saved_request,
    sanitize_request_for_storage,
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
            "descending": False,
            "pagination": {"page": 3},
            "regex": False,
            "case_sensitive": None,
        }
    ],
)
def test_sanitize_request_excludes_pagination_keys(raw_request):
    sanitized = sanitize_request_for_storage(raw_request)

    assert sanitized == {
        "node_ids": ["node-1"],
        "node_columns": {"node-1": "text"},
        "search_word": "example",
        "regex": False,
    }
    for excluded in (
        "page",
        "page_size",
        "sort_by",
        "descending",
        "pagination",
    ):
        assert excluded not in sanitized


def test_normalize_saved_request_coerces_legacy_shape():
    # We no longer support legacy request formats. Requests must include
    # `node_ids` and `node_columns`.
    raw_request = {
        "node_id": "node-legacy",
        "column": "text",
        "search_word": "alpha",
    }

    assert normalize_saved_request(raw_request) is None


def test_filter_concordance_rows_removes_blank_entries():
    df = pl.DataFrame({
        "CONC_matched_text": ["alpha", None, "   ", ""],
        "CONC_left_context": ["", "", "", ""],
        "CONC_right_context": ["", "context", "\t", None],
    })

    filtered = df.filter(concordance_non_empty_expr())

    assert filtered.height == 2


def test_core_concordance_columns_use_prefixed_names():
    assert CORE_CONCORDANCE_COLUMNS == (
        "CONC_left_context",
        "CONC_matched_text",
        "CONC_right_context",
        "CONC_start_idx",
        "CONC_end_idx",
        "CONC_l1",
        "CONC_r1",
    )
