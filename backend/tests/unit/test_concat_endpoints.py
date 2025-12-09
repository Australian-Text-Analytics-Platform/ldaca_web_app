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
        self, node_id: str, data: pl.LazyFrame, name: str | None = None
    ) -> None:
        self.node_id = node_id
        self.name = name or node_id
        self.data = data
        self.columns = list(self._schema.keys())
        self.operation = None
        self.parents = []

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
    class FakeWorkspaceManager:
        def __init__(self, nodes: dict[str, DummyNode]) -> None:
            self.nodes = nodes
            self.add_calls: list[dict[str, object]] = []

        def get_node_from_workspace(
            self, user_id: str, workspace_id: str, node_id: str
        ):
            return self.nodes.get(node_id)

        def add_node_to_workspace(self, **kwargs):
            node_name = kwargs.get("node_name") or f"concat_{len(self.add_calls)}"
            new_node = DummyNode(
                node_id=f"generated_{len(self.add_calls)}",
                data=kwargs["data"],
                name=node_name,
            )
            new_node.operation = kwargs.get("operation")
            new_node.parents = kwargs.get("parents", [])
            self.add_calls.append({"kwargs": kwargs, "node": new_node})
            return new_node

    manager = FakeWorkspaceManager(sample_nodes)
    monkeypatch.setattr(nodes_api, "workspace_manager", manager)
    monkeypatch.setattr(workspace_utils, "workspace_manager", manager)
    return manager


@pytest.mark.asyncio
async def test_concat_preview_success(fake_workspace_manager, sample_nodes):
    request = ConcatPreviewRequest(node_ids=["node_a", "node_b"])

    result = await nodes_api.concat_nodes_preview(
        "ws1", request, page=1, page_size=2, current_user={"id": "user"}
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
            "ws1", request, page=1, page_size=2, current_user={"id": "user"}
        )

    assert excinfo.value.status_code == 400
    assert "schema mismatch" in excinfo.value.detail.lower()


@pytest.mark.asyncio
async def test_concat_creation_happy_path(fake_workspace_manager, sample_nodes):
    request = ConcatRequest(node_ids=["node_a", "node_b"], new_node_name="Combined")

    result = await nodes_api.concat_nodes("ws1", request, current_user={"id": "user"})

    # ensure conversion returns meaningful structure
    assert result["name"] == "Combined"
    assert "columns" in result
    assert result["columns"] == ["id", "name", "value"]

    assert len(fake_workspace_manager.add_calls) == 1
    add_kwargs = fake_workspace_manager.add_calls[0]["kwargs"]
    assert add_kwargs["operation"].startswith("concat(")
    assert add_kwargs["parents"] == [sample_nodes["node_a"], sample_nodes["node_b"]]

    new_node = fake_workspace_manager.add_calls[0]["node"]
    collected = new_node.data.collect()
    assert collected.shape == (4, 3)
    assert collected.columns == ["id", "name", "value"]
