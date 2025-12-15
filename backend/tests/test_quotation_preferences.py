from types import SimpleNamespace
from typing import Any, Dict, List
from unittest.mock import MagicMock

import polars as pl
import pytest
from ldaca_web_app_backend.analysis.implementations.quotation import QuotationRequest
from ldaca_web_app_backend.analysis.manager import get_analysis_manager
from ldaca_web_app_backend.analysis.results import GenericAnalysisResult
from ldaca_web_app_backend.core.workspace import workspace_manager
from ldaca_web_app_backend.models import QuotationEngineConfig

USER_ID = "test"
WORKSPACE_ID = "test-workspace"
TASK = "quotation"


def _prime_workspace_state():
    """Prime workspace state for AnalysisManager-backed tests."""
    base_df = pl.DataFrame({"text": ["alpha doc", "beta doc"]})

    class DummyWorkspace:
        def __init__(self, df):
            self._df = df
            self.metadata = {}

        def get_node(self, node_id):
            return SimpleNamespace(id=node_id, data=self._df)

        def set_metadata(self, key, value):
            self.metadata[key] = value

    workspace_manager._current[USER_ID] = {  # type: ignore[attr-defined]
        "id": WORKSPACE_ID,
        "ws": DummyWorkspace(base_df),
        "path": None,
    }


def _cleanup_workspace_state():
    workspace_manager._current.pop(USER_ID, None)  # type: ignore[attr-defined]
    manager = get_analysis_manager(USER_ID, WORKSPACE_ID)
    manager.clear_all()


def _seed_paginated_analysis(rows: List[Dict[str, Any]], context_length: int = 15):
    _prime_workspace_state()
    manager = get_analysis_manager(USER_ID, WORKSPACE_ID)
    request = QuotationRequest(node_id="node-1", column="text")
    task = manager.create_task(TASK, request)

    result_dict = {
        "data": [rows[0]] if rows else [],
        "columns": list(rows[0].keys()) if rows else ["document_idx"],
        "total_rows": len(rows),
        "pagination": {
            "page": 1,
            "page_size": 1,
            "total_pages": max(1, len(rows)),
            "has_next": len(rows) > 1,
            "has_prev": False,
        },
        "sorting": {"sort_by": "document_idx", "sort_order": "asc"},
        "preferences": {"context_length": context_length},
    }

    result = GenericAnalysisResult(result_dict)
    task.complete(result)
    manager.update_task(task)


@pytest.fixture
def seeded_paginated_quotation():
    rows = [
        {"document_idx": 0, "quote": "alpha"},
        {"document_idx": 1, "quote": "beta"},
    ]
    _seed_paginated_analysis(rows)
    yield
    _cleanup_workspace_state()


@pytest.fixture
def seeded_quotation_analysis():
    _prime_workspace_state()
    manager = get_analysis_manager(USER_ID, WORKSPACE_ID)
    request = QuotationRequest(node_id="node-1", column="text")
    task = manager.create_task(TASK, request)

    result = GenericAnalysisResult({
        "data": [],
        "columns": [],
        "preferences": {"context_length": 15},
    })
    task.complete(result)
    manager.update_task(task)

    yield
    _cleanup_workspace_state()


@pytest.mark.asyncio
async def test_update_context_length_persists_preference(
    authenticated_client, seeded_quotation_analysis
):
    response = await authenticated_client.post(
        f"/api/workspaces/{WORKSPACE_ID}/quotation/current-result",
        json={"context_length": 42},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["context_length"] == 42

    manager = get_analysis_manager(USER_ID, WORKSPACE_ID)
    task = manager.get_current_task(TASK)
    assert task is not None
    assert task.result.data["preferences"]["context_length"] == 42


@pytest.mark.asyncio
async def test_update_context_length_clamps_bounds(authenticated_client):
    _prime_workspace_state()

    manager = get_analysis_manager(USER_ID, WORKSPACE_ID)
    request = QuotationRequest(node_id="node-1", column="text")
    task = manager.create_task(TASK, request)

    result = GenericAnalysisResult({"data": [], "columns": []})
    task.complete(result)
    manager.update_task(task)

    try:
        high_response = await authenticated_client.post(
            f"/api/workspaces/{WORKSPACE_ID}/quotation/current-result",
            json={"context_length": 99999},
        )
        assert high_response.status_code == 200
        assert high_response.json()["data"]["context_length"] == 2000

        low_response = await authenticated_client.post(
            f"/api/workspaces/{WORKSPACE_ID}/quotation/current-result",
            json={"context_length": -5},
        )
        assert low_response.status_code == 200
        assert low_response.json()["data"]["context_length"] == 0

        manager = get_analysis_manager(USER_ID, WORKSPACE_ID)
        task = manager.get_current_task(TASK)
        assert task is not None
        assert task.result is not None
        result = task.result.to_json()
        assert isinstance(result, dict)
        assert result["preferences"]["context_length"] == 0
    finally:
        _cleanup_workspace_state()


@pytest.mark.asyncio
async def test_quotation_current_result_respects_page_params(
    authenticated_client, seeded_paginated_quotation, monkeypatch
):
    async def fake_compute(node, base_df, column, engine, *, use_base_only=False):
        doc_ids = base_df.get_column("document_idx").to_list()
        rows = []
        for idx in doc_ids:
            if idx == 0:
                rows.append({"document_idx": 0, "quote": "alpha"})
            elif idx == 1:
                rows.append({"document_idx": 1, "quote": "beta"})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation._compute_quote_dataframe",
        fake_compute,
    )
    response = await authenticated_client.get(
        f"/api/workspaces/{WORKSPACE_ID}/quotation/current-result",
        params={"page": 2, "page_size": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 2
    assert payload["data"][0]["quote"] == "beta"


@pytest.mark.asyncio
async def test_update_quotation_current_result_returns_page_payload(
    authenticated_client, seeded_paginated_quotation, monkeypatch
):
    async def fake_compute(node, base_df, column, engine, *, use_base_only=False):
        doc_ids = base_df.get_column("document_idx").to_list()
        rows = []
        for idx in doc_ids:
            if idx == 0:
                rows.append({"document_idx": 0, "quote": "alpha"})
            elif idx == 1:
                rows.append({"document_idx": 1, "quote": "beta"})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation._compute_quote_dataframe",
        fake_compute,
    )
    response = await authenticated_client.post(
        f"/api/workspaces/{WORKSPACE_ID}/quotation/current-result",
        json={"page": 2, "page_size": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 2
    assert payload["data"][0]["quote"] == "beta"


@pytest.mark.asyncio
async def test_quotation_current_result_returns_all_quotes_for_document_page(
    authenticated_client, seeded_paginated_quotation, monkeypatch
):
    """Page size is in documents; all quotes within the selected docs should be returned."""

    async def fake_compute(node, base_df, column, engine, *, use_base_only=False):
        doc_ids = base_df.get_column("document_idx").to_list()
        rows = []
        for idx in doc_ids:
            if idx == 0:
                rows.append({"document_idx": 0, "quote": "alpha-1", "quote_row_idx": 0})
                rows.append({"document_idx": 0, "quote": "alpha-2", "quote_row_idx": 1})
            elif idx == 1:
                rows.append({"document_idx": 1, "quote": "beta-1", "quote_row_idx": 0})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation._compute_quote_dataframe",
        fake_compute,
    )

    response = await authenticated_client.get(
        f"/api/workspaces/{WORKSPACE_ID}/quotation/current-result",
        params={"page": 1, "page_size": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 1
    assert payload["pagination"]["page_size"] == 1
    assert [row["quote"] for row in payload["data"]] == ["alpha-1", "alpha-2"]


@pytest.mark.asyncio
async def test_quotation_endpoint_recomputes_on_demand(
    authenticated_client, monkeypatch, seeded_paginated_quotation
):
    class DummyWorkspace:
        def __init__(self, df):
            self._df = df

        def get_node(self, node_id):
            return SimpleNamespace(id=node_id, data=self._df, name=node_id)

    base_df = pl.DataFrame({"text": ["alpha doc", "beta doc"]})
    workspace_manager._current[USER_ID] = {
        "id": WORKSPACE_ID,
        "ws": DummyWorkspace(base_df),
        "path": None,
    }
    # No workspace-level analysis bucket; AnalysisManager holds in-memory state.

    recompute_called = False

    async def fake_compute(node, base_df_slice, column, engine, *, use_base_only=False):
        nonlocal recompute_called
        recompute_called = True
        doc_ids = base_df_slice.get_column("document_idx").to_list()
        rows = []
        for idx in doc_ids:
            if idx == 0:
                rows.append({"document_idx": 0, "quote": "alpha"})
            elif idx == 1:
                rows.append({"document_idx": 1, "quote": "beta"})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation._compute_quote_dataframe",
        fake_compute,
    )

    response = await authenticated_client.post(
        f"/api/workspaces/{WORKSPACE_ID}/nodes/node-1/quotation",
        json={"column": "text", "page": 2, "page_size": 1},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 2
    assert payload["data"][0]["quote"] == "beta"
    assert recompute_called is True
    assert recompute_called is True
