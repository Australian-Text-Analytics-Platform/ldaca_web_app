"""Runtime-only lazy-plan history for one Data Block."""

from __future__ import annotations

import polars as pl

from ldaca_wordflow.domain.workspace import Node, Workspace
from ldaca_wordflow.infrastructure.storage.workspace_store import WorkspaceStore


def _plan(value: int) -> pl.LazyFrame:
    return pl.DataFrame({"value": [value]}).lazy()


def _value(node: Node) -> int:
    return int(node.data.collect().item())


def test_node_history_is_bounded_and_moves_plans_without_recursive_checkpoints() -> (
    None
):
    node = Node(data=_plan(0), name="bounded")

    for value in range(1, 56):
        node.data = _plan(value)

    assert node.can_undo
    assert not node.can_redo

    undo_count = 0
    while node.undo_data():
        undo_count += 1

    assert undo_count == 50
    assert _value(node) == 5
    assert not node.can_undo
    assert node.can_redo

    redo_count = 0
    while node.redo_data():
        redo_count += 1

    assert redo_count == 50
    assert _value(node) == 55
    assert node.can_undo
    assert not node.can_redo


def test_new_plan_clears_redo_and_same_plan_assignment_is_a_no_op() -> None:
    node = Node(data=_plan(1), name="redo")
    second = _plan(2)
    node.data = second
    assert node.undo_data()
    assert node.can_redo

    node.data = node.data
    assert node.can_redo
    assert not node.can_undo

    node.data = _plan(3)
    assert node.can_undo
    assert not node.can_redo


def test_history_is_independent_per_data_block() -> None:
    first = Node(data=_plan(1), name="first")
    second = Node(data=_plan(10), name="second")

    first.data = _plan(2)

    assert first.can_undo
    assert not second.can_undo
    assert not second.can_redo


def test_workspace_snapshot_contains_only_current_plan_and_load_resets_history(
    tmp_path,
) -> None:
    store = WorkspaceStore(max_nodes=20, max_snapshot_bytes=8 * 1024 * 1024)
    workspace = Workspace(name="history")
    node = workspace.add_node(Node(data=_plan(1), name="source"))
    node.data = _plan(2)
    store.commit(tmp_path / "workspace", workspace, expected_revision=None)

    loaded = store.load(tmp_path / "workspace").workspace.nodes[node.id]

    assert _value(loaded) == 2
    assert not loaded.can_undo
    assert not loaded.can_redo
