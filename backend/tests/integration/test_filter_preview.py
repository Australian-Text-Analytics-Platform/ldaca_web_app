import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces import nodes as nodes_api


class DummyWorkspace:
    def __init__(self, nodes):
        self.nodes = nodes

    def get_node(self, node_id):
        return self.nodes.get(node_id)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_preview_returns_paginated_rows(authenticated_client, monkeypatch):
    df = pl.DataFrame({"value": [1, 2, 3, 4], "category": ["a", "b", "c", "d"]})

    class DummyNode:
        def __init__(self):
            self.data = df.lazy()
            self.name = "sample"

    workspace_id = "ws-any"
    dummy_ws = DummyWorkspace({"node456": DummyNode()})

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace_id",
        lambda user_id: workspace_id,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace",
        lambda user_id: dummy_ws,
    )

    response = await authenticated_client.post(
        "/api/workspaces/nodes/node456/filter/preview",
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
            self.data = df.lazy()
            self.name = "sample"

    workspace_id = "ws-any"
    dummy_ws = DummyWorkspace({"node456": DummyNode()})

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace_id",
        lambda user_id: workspace_id,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace",
        lambda user_id: dummy_ws,
    )

    response = await authenticated_client.post(
        "/api/workspaces/nodes/node456/filter/preview",
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
            self.data = df.lazy()
            self.name = "sample"

    workspace_id = "ws-any"
    dummy_ws = DummyWorkspace({"node456": DummyNode()})

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace_id",
        lambda user_id: workspace_id,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace",
        lambda user_id: dummy_ws,
    )

    response = await authenticated_client.post(
        "/api/workspaces/nodes/node456/filter/preview",
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


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_preview_in_operator_matches_any_list_string_element(
    authenticated_client, monkeypatch
):
    df = pl.DataFrame({
        "value": [1, 2, 3, 4, 5],
        "topic": [["a", "b"], ["c"], None, [], ["d", "a"]],
    })

    class DummyNode:
        def __init__(self):
            self.data = df.lazy()
            self.name = "sample"

    workspace_id = "ws-any"
    dummy_ws = DummyWorkspace({"node456": DummyNode()})

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace_id",
        lambda user_id: workspace_id,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace",
        lambda user_id: dummy_ws,
    )

    response = await authenticated_client.post(
        "/api/workspaces/nodes/node456/filter/preview",
        params={"page": 1, "page_size": 10},
        json={
            "conditions": [
                {"column": "topic", "operator": "in", "value": ["a", "x"]},
            ],
            "logic": "and",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["total_rows"] == 2
    returned_values = [row["value"] for row in payload["data"]]
    assert returned_values == [1, 5]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_preview_list_string_in_does_not_match_null_rows(
    authenticated_client, monkeypatch
):
    df = pl.DataFrame({
        "value": [1, 2, 3],
        "topic": [None, ["a"], ["b"]],
    })

    class DummyNode:
        def __init__(self):
            self.data = df.lazy()
            self.name = "sample"

    workspace_id = "ws-any"
    dummy_ws = DummyWorkspace({"node456": DummyNode()})

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace_id",
        lambda user_id: workspace_id,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_current_workspace",
        lambda user_id: dummy_ws,
    )

    response = await authenticated_client.post(
        "/api/workspaces/nodes/node456/filter/preview",
        params={"page": 1, "page_size": 10},
        json={
            "conditions": [
                {"column": "topic", "operator": "in", "value": [None]},
            ],
            "logic": "and",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["pagination"]["total_rows"] == 0
    assert payload["data"] == []
