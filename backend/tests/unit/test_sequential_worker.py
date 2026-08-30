"""Canonical process contract for Sequential Analysis."""

from datetime import datetime, UTC
from pathlib import Path

import polars as pl
import pytest
from pydantic import ValidationError

from ldaca_wordflow.analysis.sequential_core import (
    SEQUENTIAL_GROUP_INDEX_COLUMN,
    SEQUENTIAL_PERIOD_INDEX_COLUMN,
    SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN,
    SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN,
    _build_sequential_result_frames,
)
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
                        datetime(2026, 1, 1, tzinfo=UTC),
                        datetime(2026, 1, 15, tzinfo=UTC),
                    ],
                    "text": ["first", "second"],
                    "group": ["A", "a"],
                }
            ).lazy(),
            document="text",
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
    assert table[SEQUENTIAL_PERIOD_INDEX_COLUMN].to_list() == [0]
    assert table[SEQUENTIAL_GROUP_INDEX_COLUMN].to_list() == [0]
    publication = pl.read_parquet(result["publication_artifact"])
    assert publication.columns == [
        "occurred_at",
        "text",
        "group",
        SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN,
        SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN,
    ]
    assert publication.height == 2
    assert result["source"] == {
        "node_id": NODE_ID,
        "node_name": "Events",
        "document_column": "text",
        "columns": ["occurred_at", "text", "group"],
        "period_count": 1,
        "group_count": 1,
    }


def test_sequential_frames_share_stable_indices_and_preserve_original_groups() -> None:
    aggregate, publication = _build_sequential_result_frames(
        pl.DataFrame(
            {
                "value": [15.0, float("nan"), 5.0, None, 25.0],
                "group": ["B", "ignored", "A", "ignored", None],
                "text": ["fifteen", "nan", "five", "null", "twenty-five"],
            }
        ).lazy(),
        time_column="value",
        group_by_columns=["group"],
        column_type="numeric",
        numeric_interval=10,
    )

    assert aggregate.select(
        SEQUENTIAL_PERIOD_INDEX_COLUMN,
        SEQUENTIAL_GROUP_INDEX_COLUMN,
        "group",
    ).rows() == [
        (0, 1, "A"),
        (1, 2, "B"),
        (2, 0, None),
    ]
    assert publication["text"].to_list() == ["fifteen", "five", "twenty-five"]
    assert publication["group"].to_list() == ["B", "A", None]
    assert publication[SEQUENTIAL_PUBLICATION_PERIOD_INDEX_COLUMN].to_list() == [
        1,
        0,
        2,
    ]
    assert publication[SEQUENTIAL_PUBLICATION_GROUP_INDEX_COLUMN].to_list() == [
        2,
        1,
        0,
    ]


def test_sequential_frames_keep_case_variants_as_exact_multi_column_groups() -> None:
    aggregate, publication = _build_sequential_result_frames(
        pl.DataFrame(
            {
                "occurred_at": [
                    datetime(2026, 1, 1, tzinfo=UTC),
                    datetime(2026, 1, 2, tzinfo=UTC),
                    datetime(2026, 1, 3, tzinfo=UTC),
                ],
                "region": ["au", "AU", "au"],
                "party": ["jobs", "Jobs", None],
                "text": ["one", "two", "three"],
            }
        ).lazy(),
        time_column="occurred_at",
        group_by_columns=["region", "party"],
        frequency="monthly",
    )

    exact_groups = aggregate.select(
        "region",
        "party",
        SEQUENTIAL_GROUP_INDEX_COLUMN,
    ).rows()
    assert len(exact_groups) == 3
    assert {(region, party) for region, party, _index in exact_groups} == {
        ("au", "jobs"),
        ("AU", "Jobs"),
        ("au", None),
    }
    assert {index for _region, _party, index in exact_groups} == {0, 1, 2}
    assert publication.select("region", "party").rows() == [
        ("au", "jobs"),
        ("AU", "Jobs"),
        ("au", None),
    ]


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
                "case_sensitive": False,
            },
        )
