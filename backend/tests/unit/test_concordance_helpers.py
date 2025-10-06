import pytest
from ldaca_web_app_backend.api.workspaces.analyses.concordance import (
    _normalize_saved_request,
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
    raw_request = {
        "node_id": "node-legacy",
        "column": "text",
        "search_word": "alpha",
        "num_left_tokens": 4,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": True,
        "combined": False,
        "page": 3,
        "page_size": 10,
        "sort_by": "document_idx",
        "sort_order": "desc",
    }
    raw_result = {"analysis_params": {"node_id": "node-legacy", "column": "text"}}

    normalized = _normalize_saved_request(raw_request, raw_result)

    assert normalized == {
        "node_ids": ["node-legacy"],
        "node_columns": {"node-legacy": "text"},
        "search_word": "alpha",
        "num_left_tokens": 4,
        "num_right_tokens": 2,
        "regex": False,
        "case_sensitive": True,
        "combined": False,
    }
    for excluded in ("page", "page_size", "sort_by", "sort_order", "pagination"):
        assert excluded not in normalized
