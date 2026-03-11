from types import SimpleNamespace
from typing import Any, Dict, List
from unittest.mock import MagicMock

import polars as pl
import pytest
from ldaca_web_app_backend.analysis.implementations.quotation import QuotationRequest
from ldaca_web_app_backend.analysis.manager import get_task_manager
from ldaca_web_app_backend.analysis.results import GenericAnalysisResult
from ldaca_web_app_backend.core.workspace import workspace_manager
from ldaca_web_app_backend.models import QuotationEngineConfig

USER_ID = "test"
WORKSPACE_ID = "test-workspace"
TASK = "quotation"


def _prime_workspace_state():
    """Prime workspace state for TaskManager-backed tests."""
    base_df = pl.DataFrame({"text": ["alpha doc", "beta doc"]}).lazy()

    class DummyWorkspace:
        def __init__(self, df):
            self._df = df
            self.nodes = {
                "node-1": SimpleNamespace(id="node-1", name="node-1", data=self._df)
            }
            self.metadata = {}

        def get_node(self, node_id):
            return self.nodes.get(
                node_id,
                SimpleNamespace(id=node_id, name=node_id, data=self._df),
            )

        def set_metadata(self, key, value):
            self.metadata[key] = value

    dummy_ws = DummyWorkspace(base_df)
    workspace_manager._current[USER_ID] = {  # type: ignore[attr-defined]
        "wid": WORKSPACE_ID,
        "workspace": dummy_ws,
        "path": None,
    }


def _cleanup_workspace_state():
    workspace_manager._current.pop(USER_ID, None)  # type: ignore[attr-defined]
    task_manager = get_task_manager(USER_ID)
    task_manager.clear_all()


def _seed_paginated_analysis(rows: List[Dict[str, Any]], context_length: int = 15):
    _prime_workspace_state()
    task_manager = get_task_manager(USER_ID)
    request = QuotationRequest(node_id="node-1", column="text")
    task_id = task_manager.create_task(request)
    task = task_manager.get_task(task_id)

    result_dict = {
        "data": [rows[0]] if rows else [],
        "columns": list(rows[0].keys()) if rows else [],
        "total_rows": len(rows),
        "pagination": {
            "page": 1,
            "page_size": 1,
            "total_pages": max(1, len(rows)),
            "has_next": len(rows) > 1,
            "has_prev": False,
        },
        "sorting": {"sort_by": None, "descending": True},
        "preferences": {"context_length": context_length},
    }

    result = GenericAnalysisResult(result_dict)
    task.complete(result)
    task_manager.save_task(task)
    task_manager.set_current_task("quotation", task_id)
    return task_id


@pytest.fixture
def seeded_paginated_quotation():
    rows = [
        {"quote": "alpha"},
        {"quote": "beta"},
    ]
    task_id = _seed_paginated_analysis(rows)
    yield task_id
    _cleanup_workspace_state()


@pytest.fixture
def seeded_quotation_analysis():
    _prime_workspace_state()
    task_manager = get_task_manager(USER_ID)
    request = QuotationRequest(node_id="node-1", column="text")
    task_id = task_manager.create_task(request)
    task = task_manager.get_task(task_id)

    result = GenericAnalysisResult({
        "data": [],
        "columns": [],
        "preferences": {"context_length": 15},
    })
    task.complete(result)
    task_manager.save_task(task)
    task_manager.set_current_task("quotation", task_id)

    yield task_id
    _cleanup_workspace_state()


@pytest.mark.asyncio
async def test_update_context_length_persists_preference(
    authenticated_client, seeded_quotation_analysis
):
    task_id = seeded_quotation_analysis
    response = await authenticated_client.post(
        f"/api/workspaces/quotation/tasks/{task_id}/result",
        json={"context_length": 42},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["context_length"] == 42

    task_manager = get_task_manager(USER_ID)
    task = task_manager.get_task(task_id)
    assert task is not None
    assert task.result.data["preferences"]["context_length"] == 42


@pytest.mark.asyncio
async def test_update_context_length_clamps_bounds(authenticated_client):
    _prime_workspace_state()

    task_manager = get_task_manager(USER_ID)
    request = QuotationRequest(node_id="node-1", column="text")
    task_id = task_manager.create_task(request)
    task = task_manager.get_task(task_id)

    result = GenericAnalysisResult({"data": [], "columns": []})
    task.complete(result)
    task_manager.save_task(task)
    task_manager.set_current_task("quotation", task_id)

    try:
        high_response = await authenticated_client.post(
            f"/api/workspaces/quotation/tasks/{task_id}/result",
            json={"context_length": 99999},
        )
        assert high_response.status_code == 200
        assert high_response.json()["data"]["context_length"] == 2000

        low_response = await authenticated_client.post(
            f"/api/workspaces/quotation/tasks/{task_id}/result",
            json={"context_length": -5},
        )
        assert low_response.status_code == 200
        assert low_response.json()["data"]["context_length"] == 0

        task = task_manager.get_task(task_id)
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
    task_id = seeded_paginated_quotation

    async def fake_compute(
        node,
        base_df,
        column,
        engine,
        *,
        use_base_only=False,
        **_kwargs,
    ):
        doc_texts = base_df.get_column(column).to_list()
        rows = []
        for text in doc_texts:
            if "alpha" in text:
                rows.append({"QUOTE_quote": "alpha"})
            elif "beta" in text:
                rows.append({"QUOTE_quote": "beta"})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation_core.compute_quote_dataframe",
        fake_compute,
    )
    response = await authenticated_client.get(
        f"/api/workspaces/quotation/tasks/{task_id}/result",
        params={"page": 2, "page_size": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 2
    assert payload["data"][0]["QUOTE_quote"] == "beta"


@pytest.mark.asyncio
async def test_update_quotation_current_result_returns_page_payload(
    authenticated_client, seeded_paginated_quotation, monkeypatch
):
    task_id = seeded_paginated_quotation

    async def fake_compute(
        node,
        base_df,
        column,
        engine,
        *,
        use_base_only=False,
        **_kwargs,
    ):
        doc_texts = base_df.get_column(column).to_list()
        rows = []
        for text in doc_texts:
            if "alpha" in text:
                rows.append({"QUOTE_quote": "alpha"})
            elif "beta" in text:
                rows.append({"QUOTE_quote": "beta"})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation_core.compute_quote_dataframe",
        fake_compute,
    )
    response = await authenticated_client.post(
        f"/api/workspaces/quotation/tasks/{task_id}/result",
        json={"page": 2, "page_size": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 2
    assert payload["data"][0]["QUOTE_quote"] == "beta"


@pytest.mark.asyncio
async def test_quotation_current_result_returns_all_quotes_for_document_page(
    authenticated_client, seeded_paginated_quotation, monkeypatch
):
    task_id = seeded_paginated_quotation
    """Page size is in documents; all quotes within the selected docs should be returned."""

    async def fake_compute(
        node,
        base_df,
        column,
        engine,
        *,
        use_base_only=False,
        **_kwargs,
    ):
        doc_texts = base_df.get_column(column).to_list()
        rows = []
        for text in doc_texts:
            if "alpha" in text:
                rows.append({"QUOTE_quote": "alpha-1", "QUOTE_quote_row_idx": 0})
                rows.append({"QUOTE_quote": "alpha-2", "QUOTE_quote_row_idx": 1})
            elif "beta" in text:
                rows.append({"QUOTE_quote": "beta-1", "QUOTE_quote_row_idx": 0})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation_core.compute_quote_dataframe",
        fake_compute,
    )

    response = await authenticated_client.get(
        f"/api/workspaces/quotation/tasks/{task_id}/result",
        params={"page": 1, "page_size": 1},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 1
    assert payload["pagination"]["page_size"] == 1
    assert [row["QUOTE_quote"] for row in payload["data"]] == ["alpha-1", "alpha-2"]


@pytest.mark.asyncio
async def test_quotation_endpoint_recomputes_on_demand(
    authenticated_client, monkeypatch, seeded_paginated_quotation
):
    class DummyWorkspace:
        def __init__(self, df):
            self._df = df
            self.nodes = {
                "node-1": SimpleNamespace(id="node-1", name="node-1", data=self._df)
            }

        def get_node(self, node_id):
            return self.nodes.get(
                node_id,
                SimpleNamespace(id=node_id, data=self._df, name=node_id),
            )

    base_df = pl.DataFrame({"text": ["alpha doc", "beta doc"]}).lazy()
    workspace_manager._current[USER_ID] = {
        "wid": WORKSPACE_ID,
        "workspace": DummyWorkspace(base_df),
        "path": None,
    }
    # No workspace-level analysis bucket; TaskManager holds in-memory state.

    recompute_called = False

    async def fake_compute(
        node,
        base_df_slice,
        column,
        engine,
        *,
        use_base_only=False,
        **_kwargs,
    ):
        nonlocal recompute_called
        recompute_called = True
        doc_texts = base_df_slice.get_column(column).to_list()
        rows = []
        for text in doc_texts:
            if "alpha" in text:
                rows.append({"QUOTE_quote": "alpha"})
            elif "beta" in text:
                rows.append({"QUOTE_quote": "beta"})
        return pl.DataFrame(rows)

    monkeypatch.setattr(
        "ldaca_web_app_backend.api.workspaces.analyses.quotation_core.compute_quote_dataframe",
        fake_compute,
    )

    response = await authenticated_client.post(
        "/api/workspaces/nodes/node-1/quotation",
        json={"column": "text", "page": 2, "page_size": 1},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["page"] == 2
    assert payload["data"][0]["QUOTE_quote"] == "beta"
    assert recompute_called is True
    assert recompute_called is True
    assert recompute_called is True
