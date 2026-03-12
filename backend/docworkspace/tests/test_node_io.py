import json
import os
from pathlib import Path

import polars as pl
from docworkspace import Node, Workspace
from docworkspace.node.io import dumps, from_dict, loads, to_dict


def test_node_to_dict_persists_lazyframe_payload(tmp_path: Path):
    workspace = Workspace("node_io")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame({"text": ["a", "b"], "value": [1, 2]}).lazy(),
            name="root",
            workspace=workspace,
            operation="source",
        )
    )
    node.document = "text"

    previous_cwd = Path.cwd()
    os.chdir(tmp_path)
    try:
        payload = to_dict(node)
    finally:
        os.chdir(previous_cwd)

    assert payload == {
        "node_metadata": {
            "id": node.id,
            "name": "root",
            "operation": "source",
            "document": "text",
            "parents": [],
        },
        "data_path": f"data/{node.id}.plbin",
    }

    data_file = tmp_path / payload["data_path"]
    assert data_file.exists()
    restored = pl.LazyFrame.deserialize(data_file.open("rb"), format="binary")
    assert restored.collect().to_dict(as_series=False) == {
        "text": ["a", "b"],
        "value": [1, 2],
    }


def test_node_dumps_returns_json_payload_and_persists_data_file(tmp_path: Path):
    workspace = Workspace("node_io")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame({"value": [1, 2, 3]}).lazy(),
            name="root",
            workspace=workspace,
        )
    )

    previous_cwd = Path.cwd()
    os.chdir(tmp_path)
    try:
        serialized = dumps(node)
    finally:
        os.chdir(previous_cwd)
    payload = json.loads(serialized)

    assert payload["node_metadata"]["id"] == node.id
    assert payload["data_path"] == f"data/{node.id}.plbin"
    assert (tmp_path / payload["data_path"]).exists()


def test_node_from_dict_restores_node_state(tmp_path: Path):
    source_workspace = Workspace("source")
    node = source_workspace.add_node(
        Node(
            data=pl.DataFrame({"text": ["x", "y"], "value": [10, 20]}).lazy(),
            name="restorable",
            workspace=source_workspace,
            operation="filter",
        )
    )
    node.document = "text"
    previous_cwd = Path.cwd()
    os.chdir(tmp_path)
    try:
        payload = to_dict(node)

        restored_workspace = Workspace("restored")
        restored = from_dict(payload, workspace=restored_workspace)
    finally:
        os.chdir(previous_cwd)

    assert restored.id == node.id
    assert restored.name == "restorable"
    assert restored.operation == "filter"
    assert restored.document == "text"
    assert restored.workspace is restored_workspace
    assert restored.parents == []
    assert restored.children == []
    assert restored.can_undo is False
    assert restored.can_redo is False
    assert restored.data.collect().to_dict(as_series=False) == {
        "text": ["x", "y"],
        "value": [10, 20],
    }


def test_node_loads_round_trip_from_json_string(tmp_path: Path):
    source_workspace = Workspace("source")
    node = source_workspace.add_node(
        Node(
            data=pl.DataFrame({"value": [3, 4]}).lazy(),
            name="round_trip",
            workspace=source_workspace,
        )
    )

    previous_cwd = Path.cwd()
    os.chdir(tmp_path)
    try:
        serialized = dumps(node)
        restored = loads(serialized, workspace=Workspace("restored"))
    finally:
        os.chdir(previous_cwd)

    assert restored.id == node.id
    assert restored.name == "round_trip"
    assert restored.data.collect().to_dict(as_series=False) == {"value": [3, 4]}


def test_node_from_dict_uses_constructor_defaults_for_runtime_state(tmp_path: Path):
    source_workspace = Workspace("source")
    node = source_workspace.add_node(
        Node(
            data=pl.DataFrame({"value": [1, 2]}).lazy(),
            name="constructor_restore",
            workspace=source_workspace,
        )
    )
    previous_cwd = Path.cwd()
    os.chdir(tmp_path)
    try:
        payload = to_dict(node)
        restored = from_dict(payload, workspace=Workspace("restored"))
    finally:
        os.chdir(previous_cwd)

    restored.data = restored.data.with_columns(pl.lit(9).alias("extra"))
    assert restored.can_undo is True


def test_node_from_dict_restores_existing_parent_nodes_by_id(tmp_path: Path):
    workspace = Workspace("source")
    parent = workspace.add_node(
        Node(
            data=pl.DataFrame({"value": [1]}).lazy(), name="parent", workspace=workspace
        )
    )
    child = parent.filter(pl.col("value") > 0)

    previous_cwd = Path.cwd()
    os.chdir(tmp_path)
    try:
        payload = to_dict(child)
        restored_workspace = Workspace("restored")
        restored_parent = Node(
            data=pl.DataFrame({"value": [1]}).lazy(),
            name="parent",
            workspace=restored_workspace,
            id=parent.id,
        )

        restored_child = from_dict(payload, workspace=restored_workspace)
    finally:
        os.chdir(previous_cwd)

    assert restored_child.parents == [restored_parent]


def test_node_from_dict_ignores_missing_parent_ids(tmp_path: Path):
    workspace = Workspace("source")
    node = workspace.add_node(
        Node(
            data=pl.DataFrame({"value": [1]}).lazy(), name="child", workspace=workspace
        )
    )

    previous_cwd = Path.cwd()
    os.chdir(tmp_path)
    try:
        payload = to_dict(node)
        payload["node_metadata"]["parents"] = ["missing-parent-id"]
        restored = from_dict(payload, workspace=Workspace("restored"))
    finally:
        os.chdir(previous_cwd)

    assert restored.parents == []
