import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces import nodes as nodes_api


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_preview_returns_paginated_rows(authenticated_client, monkeypatch):
    df = pl.DataFrame({"value": [1, 2, 3, 4], "category": ["a", "b", "c", "d"]})

    class DummyNode:
        def __init__(self):
            self.data = df
            self.name = "sample"
            self.is_lazy = False

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_node_from_workspace",
        lambda user_id, workspace_id, node_id: DummyNode(),
    )

    response = await authenticated_client.post(
        "/api/workspaces/ws123/nodes/node456/filter/preview",
        params={"page": 1, "page_size": 2},
        json={
            "conditions": [
                {"column": "value", "operator": "gte", "value": 2},
            ],
            "logic": "and",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["total_rows"] == 3
    assert payload["pagination"]["page_size"] == 2
    assert payload["pagination"]["page"] == 1
    assert payload["pagination"]["has_next"] is True
    assert len(payload["data"]) == 2
    assert payload["data"][0]["value"] == 2


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_preview_in_operator(authenticated_client, monkeypatch):
    df = pl.DataFrame({
        "value": [1, 2, 3, 4],
        "category": ["a", "b", "a", "c"],
    })

    class DummyNode:
        def __init__(self):
            self.data = df
            self.name = "sample"
            self.is_lazy = False

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_node_from_workspace",
        lambda user_id, workspace_id, node_id: DummyNode(),
    )

    response = await authenticated_client.post(
        "/api/workspaces/ws123/nodes/node456/filter/preview",
        params={"page": 1, "page_size": 10},
        json={
            "conditions": [
                {"column": "category", "operator": "in", "value": ["a", "c"]},
            ],
            "logic": "and",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["total_rows"] == 3
    returned_categories = {row["category"] for row in payload["data"]}
    assert returned_categories == {"a", "c"}


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_preview_in_operator_with_null(authenticated_client, monkeypatch):
    df = pl.DataFrame({
        "value": [1, 2, 3, 4],
        "category": ["a", None, "b", None],
    })

    class DummyNode:
        def __init__(self):
            self.data = df
            self.name = "sample"
            self.is_lazy = False

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_node_from_workspace",
        lambda user_id, workspace_id, node_id: DummyNode(),
    )

    response = await authenticated_client.post(
        "/api/workspaces/ws123/nodes/node456/filter/preview",
        params={"page": 1, "page_size": 10},
        json={
            "conditions": [
                {"column": "category", "operator": "in", "value": [None]},
            ],
            "logic": "and",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["total_rows"] == 2
    returned_categories = [row["category"] for row in payload["data"]]
    assert all(category is None for category in returned_categories)
