"""Canonical process contract for Sequential Analysis."""

from datetime import datetime, timezone
from pathlib import Path

import polars as pl
import pytest
from pydantic import ValidationError

from ldaca_wordflow.domain.workspace import Node, Workspace
from ldaca_wordflow.workers.input_snapshots import create_worker_input_snapshot
from ldaca_wordflow.workers.sequential import run_sequential_analysis

NODE_ID = "00000000-0000-0000-0000-000000000001"


def _snapshot(tmp_path: Path) -> Path:
    data_root = tmp_path / "data"
    data_root.mkdir()
    workspace = Workspace(name="sequential", workspace_id="workspace")
    workspace.add_node(
        Node(
            id=NODE_ID,
            name="Events",
            data=pl.DataFrame(
                {
                    "occurred_at": [
                        datetime(2026, 1, 1, tzinfo=timezone.utc),
                        datetime(2026, 1, 15, tzinfo=timezone.utc),
                    ]
                }
            ).lazy(),
        )
    )
    return create_worker_input_snapshot(
        workspace_id=workspace.id,
        node_ids=[NODE_ID],
        workspace=workspace,
        workspace_data_dir=data_root,
        snapshot_dir=tmp_path / "snapshot",
        max_snapshot_bytes=1024 * 1024,
    )


def test_sequential_worker_validates_and_executes_the_typed_request(
    tmp_path: Path,
) -> None:
    result = run_sequential_analysis(
        user_id="user",
        workspace_id="workspace",
        input_snapshot_dir=str(_snapshot(tmp_path)),
        artifact_dir=str(tmp_path / "output"),
        node_id=NODE_ID,
        request_payload={
            "time_column": "occurred_at",
            "frequency": "monthly",
        },
    )

    assert result["state"] == "successful"
    table = pl.read_ipc_stream(result["table"]["artifact"])
    assert table.height == 1
    assert table["sequential_count"].to_list() == [2]


def test_sequential_worker_rejects_noncanonical_request_fields(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        run_sequential_analysis(
            user_id="user",
            workspace_id="workspace",
            input_snapshot_dir=str(_snapshot(tmp_path)),
            artifact_dir=str(tmp_path / "output"),
            node_id=NODE_ID,
            request_payload={
                "time_column": "occurred_at",
                "frequency": "monthly",
                "legacy_frequency": "daily",
            },
        )
