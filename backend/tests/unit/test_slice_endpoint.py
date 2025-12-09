"""Unit tests for the slice node endpoint."""

from __future__ import annotations

import polars as pl
import pytest
from ldaca_web_app_backend.api.workspaces import nodes as nodes_api
from ldaca_web_app_backend.api.workspaces import utils as workspace_utils
from ldaca_web_app_backend.core.docworkspace_api import create_operation_result
from ldaca_web_app_backend.models import SliceRequest


class DummyNode:
    """Lightweight node stub used for slice endpoint tests."""

    def __init__(self, node_id: str, data: pl.LazyFrame, name: str) -> None:
        self.id = node_id
        self.node_id = node_id
        self.name = name
        self.data = data
        self.operation = None
        self.parents: list[DummyNode] = []


class FakeWorkspaceManager:
    """Fake workspace manager that captures slice operations."""

    def __init__(self, nodes: dict[str, DummyNode]) -> None:
        self.nodes = nodes
        self.add_calls: list[dict[str, object]] = []

    def get_node_from_workspace(self, _user_id: str, _workspace_id: str, node_id: str):
        return self.nodes.get(node_id)

    def add_node_to_workspace(self, **kwargs):
        new_id = f"generated_{len(self.add_calls)}"
        new_node = DummyNode(
            node_id=new_id,
            data=kwargs["data"],
            name=kwargs.get("node_name") or new_id,
        )
        new_node.operation = kwargs.get("operation")
        new_node.parents = kwargs.get("parents", [])
        self.add_calls.append({"kwargs": kwargs, "node": new_node})
        return new_node

    def execute_safe_operation(
        self, _user_id: str, _workspace_id: str, func, *args, **kwargs
    ):
        try:
            result = func(*args, **kwargs)
            if isinstance(result, DummyNode):
                return create_operation_result(
                    success=True,
                    message="Operation completed successfully",
                    node_id=result.id,
                    data={
                        "node_name": result.name,
                        "data_type": type(result.data).__name__,
                    },
                )
            return create_operation_result(
                success=True,
                message="Operation completed successfully",
                data={"result": result},
            )
        except Exception as exc:  # pragma: no cover - defensive guard
            return create_operation_result(
                success=False,
                message=f"Operation failed: {exc}",
                errors=[str(exc)],
            )


@pytest.fixture
def fake_workspace_manager(monkeypatch: pytest.MonkeyPatch):
    df = pl.DataFrame({
        "value": [1, 2, 3, 4, 5],
        "label": ["a", "b", "c", "d", "e"],
    })
    original_node = DummyNode("node_base", df.lazy(), "base_node")
    manager = FakeWorkspaceManager({"node_base": original_node})
    monkeypatch.setattr(nodes_api, "workspace_manager", manager)
    monkeypatch.setattr(workspace_utils, "workspace_manager", manager)
    return manager


@pytest.mark.asyncio
async def test_slice_node_with_offset_and_length(fake_workspace_manager):
    request = SliceRequest(offset=1, length=2, new_node_name="subset_rows")

    result = await nodes_api.slice_node(
        "ws1", "node_base", request, current_user={"id": "user"}
    )

    assert result.success is True
    assert result.data["node_name"] == "subset_rows"
    assert result.node_id == "generated_0"

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
        "ws1", "node_base", request, current_user={"id": "user"}
    )

    assert result.success is True
    assert result.data["node_name"] == "base_node_sliced"
    assert result.node_id == "generated_0"

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
        "ws1",
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
        "ws1",
        "node_base",
        request,
        page=2,
        page_size=2,
        current_user={"id": "user"},
    )

    assert preview_page_two["pagination"]["page"] == 2
    assert len(preview_page_two["data"]) == 1
    assert preview_page_two["data"][0]["value"] == 4
