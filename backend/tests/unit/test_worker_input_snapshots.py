"""Atomic publication contract for private worker input snapshots."""

import json
import os
import uuid
from pathlib import Path

import polars as pl
import pytest
from polars_source_utils import list_source_paths

from ldaca_wordflow.infrastructure.storage.input_snapshots import (
    create_worker_input_snapshot,
    load_snapshot_node,
    rebase_worker_input_snapshot_sources,
)
from ldaca_wordflow.domain.workspace import Node, Workspace
from ldaca_wordflow.infrastructure.storage import input_snapshots as snapshot_module


_WORKSPACE_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
_IMPORTED_WORKSPACE_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
_NODE_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
_FIRST_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")
_SECOND_ID = uuid.UUID("55555555-5555-4555-8555-555555555555")


def _node(node_id: uuid.UUID, plan: pl.LazyFrame) -> Node:
    return Node(
        id=node_id,
        name=str(node_id),
        data=plan,
    )


def test_failed_snapshot_never_publishes_a_partial_execution_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace = Workspace(name="snapshot", workspace_id=_WORKSPACE_ID)
    workspace.add_node(_node(_FIRST_ID, pl.DataFrame({"value": [1]}).lazy()))
    workspace.add_node(_node(_SECOND_ID, pl.DataFrame({"value": [2]}).lazy()))
    calls = 0
    original = snapshot_module._snapshot_plan_sources

    def fail_second(*args, **kwargs) -> None:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated plan failure")
        original(*args, **kwargs)

    monkeypatch.setattr(
        snapshot_module,
        "_snapshot_plan_sources",
        fail_second,
    )

    with pytest.raises(OSError, match="plan failure"):
        create_worker_input_snapshot(
            workspace_id=_WORKSPACE_ID,
            node_ids=[_FIRST_ID, _SECOND_ID],
            workspace=workspace,
            workspace_data_dir=tmp_path,
            snapshot_dir=tmp_path / "snapshots" / "input",
            max_snapshot_bytes=1024 * 1024,
        )

    snapshot_root = tmp_path / "snapshots"
    assert not (snapshot_root / "input").exists()
    assert list(snapshot_root.iterdir()) == []


def test_snapshot_pins_sources_after_workspace_data_is_deleted(tmp_path: Path) -> None:
    data_root = tmp_path / "data"
    data_root.mkdir()
    source = data_root / "source.parquet"
    pl.DataFrame({"value": ["retained"]}).write_parquet(source)
    workspace = Workspace(name="snapshot", workspace_id=_WORKSPACE_ID)
    workspace.add_node(_node(_NODE_ID, pl.scan_parquet(source.resolve())))

    snapshot = create_worker_input_snapshot(
        workspace_id=_WORKSPACE_ID,
        node_ids=[_NODE_ID],
        workspace=workspace,
        workspace_data_dir=data_root,
        snapshot_dir=tmp_path / "snapshots" / "input",
        max_snapshot_bytes=1024 * 1024,
    )
    source.unlink()

    restored = load_snapshot_node(snapshot, _NODE_ID)
    collected = restored.data.collect()
    assert collected.to_dicts() == [{"value": "retained"}]
    plan_sources = list_source_paths(snapshot / "data" / f"{_NODE_ID}.plbin")
    assert all(Path(path).is_relative_to(snapshot / "sources") for path in plan_sources)


def test_relocated_snapshot_rebases_sources_and_workspace_identity(
    tmp_path: Path,
) -> None:
    data_root = tmp_path / "data"
    data_root.mkdir()
    source = data_root / "source.parquet"
    pl.DataFrame({"value": ["retained"]}).write_parquet(source)
    workspace = Workspace(name="snapshot", workspace_id=_WORKSPACE_ID)
    workspace.add_node(_node(_NODE_ID, pl.scan_parquet(source.resolve())))
    original_owner = tmp_path / "original-owner"
    create_worker_input_snapshot(
        workspace_id=workspace.id,
        node_ids=[_NODE_ID],
        workspace=workspace,
        workspace_data_dir=data_root,
        snapshot_dir=original_owner / "query-input",
        max_snapshot_bytes=1024 * 1024,
    )
    relocated_owner = tmp_path / "relocated-owner"
    os.replace(original_owner, relocated_owner)
    relocated = relocated_owner / "query-input"

    rebase_worker_input_snapshot_sources(
        relocated,
        workspace_id=_IMPORTED_WORKSPACE_ID,
    )

    restored = load_snapshot_node(relocated, _NODE_ID)
    assert restored.data.collect().to_dicts() == [{"value": "retained"}]
    assert json.loads((relocated / "snapshot.json").read_text())["workspace_id"] == (
        str(_IMPORTED_WORKSPACE_ID)
    )
    plan_sources = list_source_paths(relocated / "data" / f"{_NODE_ID}.plbin")
    assert all(Path(path).is_relative_to(relocated / "sources") for path in plan_sources)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda payload: payload["nodes"][str(_NODE_ID)].pop("name"), "name"),
        (
            lambda payload: payload["nodes"][str(_NODE_ID)].__setitem__(
                "unknown", True
            ),
            "unknown",
        ),
        (
            lambda payload: payload["nodes"][str(_NODE_ID)].__setitem__(
                "id", str(_FIRST_ID)
            ),
            "key does not match",
        ),
    ],
)
def test_snapshot_loader_rejects_noncanonical_node_metadata(
    tmp_path: Path,
    mutation,
    message: str,
) -> None:
    data_root = tmp_path / "data"
    data_root.mkdir()
    workspace = Workspace(name="snapshot", workspace_id=_WORKSPACE_ID)
    workspace.add_node(_node(_NODE_ID, pl.DataFrame({"value": [1]}).lazy()))
    snapshot = create_worker_input_snapshot(
        workspace_id=workspace.id,
        node_ids=[_NODE_ID],
        workspace=workspace,
        workspace_data_dir=data_root,
        snapshot_dir=tmp_path / "snapshots" / "input",
        max_snapshot_bytes=1024 * 1024,
    )
    metadata_path = snapshot / "snapshot.json"
    payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    mutation(payload)
    metadata_path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises((ValueError, KeyError), match=message):
        load_snapshot_node(snapshot, _NODE_ID)
