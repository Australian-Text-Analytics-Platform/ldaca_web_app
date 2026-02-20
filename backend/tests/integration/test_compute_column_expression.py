import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces import nodes as nodes_api


class _DummyNode:
    def __init__(self, frame: pl.DataFrame):
        self.data = frame.lazy()
        self.name = "dummy"


class _DummyWorkspace:
    def __init__(self, persist_calls: dict[str, int]):
        self.name = "ws"
        self._persist_calls = persist_calls

    def set_metadata(self, *_args, **_kwargs):
        return None

    def save(self, *_args, **_kwargs):
        self._persist_calls["count"] += 1


@pytest.mark.integration
@pytest.mark.asyncio
async def test_compute_column_preview_adds_new_column(
    authenticated_client, monkeypatch
):
    frame = pl.DataFrame({
        "A": [1, 2, 3],
        "B": [10, 20, 30],
        "Total Count": [5, 6, 7],
    })
    node = _DummyNode(frame)

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_node_from_workspace",
        lambda user_id, workspace_id, node_id: node,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_workspace",
        lambda user_id, workspace_id: _DummyWorkspace({"count": 0}),
    )

    response = await authenticated_client.post(
        "/api/workspaces/ws-alpha/nodes/node-123/compute-column/preview",
        json={
            "expression": 'A + "Total Count"',
            "preview_limit": 2,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]) == 2
    column_set = set(payload["columns"])
    assert {"A", "B", "Total Count"}.issubset(column_set)
    new_columns = column_set - {"A", "B", "Total Count"}
    assert len(new_columns) == 1
    new_column_name = next(iter(new_columns))
    first_row = payload["data"][0]
    assert first_row[new_column_name] == pytest.approx(1 + 5)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_compute_column_apply_mutates_node(authenticated_client, monkeypatch):
    frame = pl.DataFrame({
        "A": [1, 2],
        "B": [3, 4],
    })
    node = _DummyNode(frame)
    persist_calls = {"count": 0}

    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_node_from_workspace",
        lambda user_id, workspace_id, node_id: node,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "_resolve_workspace_dir",
        lambda user_id, workspace_id, workspace_name: "/tmp/ws",
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "_attach_workspace_dir",
        lambda workspace, path: None,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "_set_cached_path",
        lambda user_id, workspace_id, path: None,
    )
    monkeypatch.setattr(
        nodes_api.workspace_manager,
        "get_workspace",
        lambda user_id, workspace_id: _DummyWorkspace(persist_calls),
    )
    response = await authenticated_client.post(
        "/api/workspaces/ws-alpha/nodes/node-123/compute-column",
        json={
            "expression": "A + B",
            "new_column_name": "A_plus_B",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["column_name"] == "A_plus_B"
    assert payload["state"] == "successful"
    collected = node.data.collect()
    assert "A_plus_B" in collected.columns
    assert collected["A_plus_B"].to_list() == [4, 6]
    assert persist_calls["count"] == 1
