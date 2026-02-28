"""Unit tests for the slice node endpoint."""

from __future__ import annotations

import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces import nodes as nodes_api
from ldaca_web_app_backend.api.workspaces import utils as workspace_utils
from ldaca_web_app_backend.models import SliceRequest


class DummyNode:
    """Lightweight node stub used for slice endpoint tests."""

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
        manager = getattr(workspace, "_manager", None)
        generated_index = len(getattr(manager, "add_calls", []))
        generated_id = node_id or f"generated_{generated_index}"
        self.id = generated_id
        self.node_id = generated_id
        self.name = name
        self.data = data
        self.operation = operation
        self.parents: list[DummyNode] = parents or []


class DummyWorkspace:
    def __init__(self, nodes: dict[str, DummyNode], manager: "FakeWorkspaceManager"):
        self.nodes = nodes
        self._manager = manager
        self.name = "dummy"

    def add_node(self, node: DummyNode):
        self.nodes[node.id] = node
        self._manager.add_calls.append({"node": node})

    def save(self, _target_dir):
        return None


class FakeWorkspaceManager:
    """Fake workspace manager that captures slice operations."""

    def __init__(self, nodes: dict[str, DummyNode]) -> None:
        self.nodes = nodes
        self.workspace_id = "ws1"
        self.workspace = DummyWorkspace(self.nodes, self)
        self.add_calls: list[dict[str, object]] = []

    def get_current_workspace(self, _user_id: str):
        return self.workspace

    def get_current_workspace_id(self, _user_id: str):
        return self.workspace_id

    def get_current_workspace_path(self, _user_id: str):
        return "workspace_path"

    def save_workspace(self, _user_id: str, _workspace_id: str) -> None:
        pass

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


@pytest.fixture
def fake_workspace_manager(monkeypatch: pytest.MonkeyPatch):
    df = pl.DataFrame({
        "value": [1, 2, 3, 4, 5],
        "label": ["a", "b", "c", "d", "e"],
    })
    original_node = DummyNode("node_base", df.lazy(), "base_node")
    manager = FakeWorkspaceManager({"node_base": original_node})
    monkeypatch.setattr(nodes_api, "workspace_manager", manager)
    monkeypatch.setattr(nodes_api, "Node", DummyNode)
    monkeypatch.setattr(workspace_utils, "workspace_manager", manager)
    return manager


@pytest.mark.asyncio
async def test_slice_node_with_offset_and_length(fake_workspace_manager):
    request = SliceRequest(offset=1, length=2, new_node_name="subset_rows")

    result = await nodes_api.slice_node(
        "node_base", request, current_user={"id": "user"}
    )

    assert result["node_name"] == "subset_rows"
    assert result["node_id"] == "generated_0"

    assert len(fake_workspace_manager.add_calls) == 1
    created = fake_workspace_manager.add_calls[0]["node"]
    collected = created.data.collect()
    assert collected.shape == (2, 2)
    assert collected.get_column("value").to_list() == [2, 3]
    assert created.parents == [fake_workspace_manager.nodes["node_base"]]
    assert created.operation == "slice(base_node, offset=1, length=2)"


@pytest.mark.asyncio
async def test_slice_node_without_length_uses_tail(fake_workspace_manager):
    request = SliceRequest(offset=3)

    result = await nodes_api.slice_node(
        "node_base", request, current_user={"id": "user"}
    )

    assert result["node_name"] == "base_node_sliced"
    assert result["node_id"] == "generated_0"

    assert len(fake_workspace_manager.add_calls) == 1
    created = fake_workspace_manager.add_calls[0]["node"]
    collected = created.data.collect()
    assert collected.shape == (2, 2)
    assert collected.get_column("value").to_list() == [4, 5]
    assert created.operation == "slice(base_node, offset=3)"


@pytest.mark.asyncio
async def test_slice_preview_respects_offset_and_length(fake_workspace_manager):
    request = SliceRequest(offset=1, length=3)

    preview = await nodes_api.slice_preview(
        "node_base",
        request,
        page=1,
        page_size=2,
        current_user={"id": "user"},
    )

    assert preview["columns"] == ["value", "label"]
    assert preview["pagination"]["total_rows"] == 3
    assert preview["pagination"]["page"] == 1
    assert len(preview["data"]) == 2
    assert [row["value"] for row in preview["data"]] == [2, 3]

    preview_page_two = await nodes_api.slice_preview(
        "node_base",
        request,
        page=2,
        page_size=2,
        current_user={"id": "user"},
    )

    assert preview_page_two["pagination"]["page"] == 2
    assert len(preview_page_two["data"]) == 1
    assert preview_page_two["data"][0]["value"] == 4
