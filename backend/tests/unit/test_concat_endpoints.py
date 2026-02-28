"""Unit tests for concat preview and creation endpoints."""

from __future__ import annotations

import polars as pl
import pytest
from fastapi import HTTPException
from ldaca_web_app_backend.api.workspaces import nodes as nodes_api
from ldaca_web_app_backend.api.workspaces import utils as workspace_utils
from ldaca_web_app_backend.models import ConcatPreviewRequest, ConcatRequest


class DummyNode:
    def __init__(
        self,
        node_id: str | None = None,
        data: pl.LazyFrame | None = None,
        name: str | None = None,
        workspace: object | None = None,
        operation: str | None = None,
        parents: list["DummyNode"] | None = None,
        **_kwargs,
    ) -> None:
        generated_id = node_id or f"generated_{len(getattr(workspace, 'nodes', {}))}"
        self.id = generated_id
        self.node_id = generated_id
        self.name = name or generated_id
        self.data = data
        self.columns = list(self._schema.keys())
        self.operation = operation
        self.parents = parents or []

    @property
    def _schema(self) -> dict[str, pl.DataType]:
        if hasattr(self.data, "collect_schema"):
            try:
                return dict(self.data.collect_schema())
            except Exception:
                pass
        if hasattr(self.data, "schema"):
            return dict(self.data.schema)
        return {}

    def info(self) -> dict[str, object]:
        return {
            "node_id": self.node_id,
            "name": self.name,
            "columns": list(self._schema.keys()),
            "schema": self._schema,
            "dtype": "DataFrame",
        }


@pytest.fixture
def sample_nodes() -> dict[str, DummyNode]:
    df_one = pl.DataFrame({
        "id": [1, 2],
        "name": ["alpha", "beta"],
        "value": [10.0, 20.0],
    })
    # Same columns, different order to verify reordering is allowed
    df_two = pl.DataFrame({
        "value": [30.0, 40.0],
        "name": ["gamma", "delta"],
        "id": [3, 4],
    })
    df_bad = pl.DataFrame({"id": [1, 2], "other": [100, 200]})

    return {
        "node_a": DummyNode("node_a", df_one.lazy(), name="First"),
        "node_b": DummyNode("node_b", df_two.lazy(), name="Second"),
        "node_bad": DummyNode("node_bad", df_bad.lazy(), name="Mismatch"),
    }


@pytest.fixture
def fake_workspace_manager(monkeypatch: pytest.MonkeyPatch, sample_nodes):
    class DummyWorkspace:
        def __init__(
            self, nodes: dict[str, DummyNode], manager: "FakeWorkspaceManager"
        ) -> None:
            self.nodes = nodes
            self._manager = manager
            self.name = "dummy"

        def add_node(self, node: DummyNode):
            self.nodes[node.node_id] = node
            self._manager.add_calls.append({"node": node})

        def save(self, _target_dir):
            return None

    class FakeWorkspaceManager:
        def __init__(self, nodes: dict[str, DummyNode]) -> None:
            self.nodes = nodes
            self.workspace_id = "ws1"
            self.workspace = DummyWorkspace(nodes, self)
            self.add_calls: list[dict[str, object]] = []

        def get_current_workspace(self, _user_id: str):
            return self.workspace

        def get_current_workspace_id(self, _user_id: str):
            return self.workspace_id

        def get_current_workspace_path(self, _user_id: str):
            return "workspace_path"

        def _resolve_workspace_dir(
            self,
            user_id: str,
            workspace_id: str,
            workspace_name: str,
        ):
            return "workspace_path"

        def _attach_workspace_dir(self, workspace, target_dir):
            return None

        def _set_cached_path(self, user_id: str, workspace_id: str, target_dir):
            return None

        def set_current_workspace(self, user_id: str, workspace_id: str):
            self.workspace_id = workspace_id
            return True

    manager = FakeWorkspaceManager(sample_nodes)
    monkeypatch.setattr(nodes_api, "workspace_manager", manager)
    monkeypatch.setattr(nodes_api, "Node", DummyNode)
    monkeypatch.setattr(workspace_utils, "workspace_manager", manager)
    return manager


@pytest.mark.asyncio
async def test_concat_preview_success(fake_workspace_manager, sample_nodes):
    request = ConcatPreviewRequest(node_ids=["node_a", "node_b"])

    result = await nodes_api.concat_nodes_preview(
        request, page=1, page_size=2, current_user={"id": "user"}
    )

    assert result["columns"] == ["id", "name", "value"]
    assert result["dtypes"]["id"].lower().startswith("int")
    assert result["pagination"]["total_rows"] == 4
    assert result["pagination"]["has_next"] is True
    assert len(result["data"]) == 2
    # ensure workspace manager was not asked to persist anything yet
    assert not fake_workspace_manager.add_calls


@pytest.mark.asyncio
async def test_concat_preview_schema_mismatch(fake_workspace_manager):
    request = ConcatPreviewRequest(node_ids=["node_a", "node_bad"])

    with pytest.raises(HTTPException) as excinfo:
        await nodes_api.concat_nodes_preview(
            request, page=1, page_size=2, current_user={"id": "user"}
        )

    assert excinfo.value.status_code == 400
    assert "schema mismatch" in excinfo.value.detail.lower()


@pytest.mark.asyncio
async def test_concat_creation_happy_path(fake_workspace_manager, sample_nodes):
    request = ConcatRequest(node_ids=["node_a", "node_b"], new_node_name="Combined")

    result = await nodes_api.concat_nodes(request, current_user={"id": "user"})

    # ensure conversion returns meaningful structure
    assert result["name"] == "Combined"
    assert "columns" in result
    assert result["columns"] == ["id", "name", "value"]

    assert len(fake_workspace_manager.add_calls) == 1
    new_node = fake_workspace_manager.add_calls[0]["node"]
    assert new_node.operation.startswith("concat(")
    assert new_node.parents == [sample_nodes["node_a"], sample_nodes["node_b"]]
    collected = new_node.data.collect()
    assert collected.shape == (4, 3)
    assert collected.columns == ["id", "name", "value"]
