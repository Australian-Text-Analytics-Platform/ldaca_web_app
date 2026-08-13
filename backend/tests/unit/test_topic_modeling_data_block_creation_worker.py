from __future__ import annotations

import uuid
from pathlib import Path

import polars as pl
import pytest

from ldaca_wordflow.analysis.generated_columns import (
    TOPIC_COLUMN,
    TOPIC_DISTRIBUTION_COLUMN,
    TOPIC_DISTRIBUTION_OUTPUT_COLUMN,
    TOPIC_MEANING_COLUMN,
    TOPIC_TOP1_COLUMN,
)
from ldaca_wordflow.domain.workspace import Node, SourceProvenance, Workspace
from ldaca_wordflow.shared.topic_types import topic_distribution_dtype
from ldaca_wordflow.workers.input_snapshots import create_worker_input_snapshot
from ldaca_wordflow.workers.topic_modeling import run_topic_modeling_data_block_creation


def test_topic_modeling_data_block_creation_publishes_ordered_data_and_meanings(
    tmp_path: Path,
) -> None:
    first_id = uuid.uuid4()
    second_id = uuid.uuid4()
    workspace = Workspace(name="topics")
    for node_id, name in ((first_id, "First"), (second_id, "Second")):
        workspace.add_node(
            Node(
                id=str(node_id),
                name=name,
                data=pl.DataFrame(
                    {"text": ["zero", "one", "two"], "ignored": [0, 1, 2]}
                ).lazy(),
                provenance=SourceProvenance(),
                document="text",
                color="#123456",
            )
        )
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    snapshot_dir = tmp_path / "input"
    create_worker_input_snapshot(
        workspace_id=workspace.id,
        node_ids=[str(first_id), str(second_id)],
        workspace=workspace,
        workspace_data_dir=data_dir,
        snapshot_dir=snapshot_dir,
        max_snapshot_bytes=10_000_000,
    )
    distribution = [
        [
            {"topic_id": -1, "proportion": 0.0},
            {"topic_id": 0, "proportion": 0.0},
            {"topic_id": 1, "proportion": 1.0},
        ],
        [
            {"topic_id": -1, "proportion": 0.0},
            {"topic_id": 0, "proportion": 0.0},
            {"topic_id": 1, "proportion": 0.0},
        ],
        [
            {"topic_id": -1, "proportion": 0.0},
            {"topic_id": 0, "proportion": 0.0},
            {"topic_id": 1, "proportion": 1.0},
        ],
    ]
    assignment_paths: dict[str, str] = {}
    for node_id in (first_id, second_id):
        path = tmp_path / f"{node_id}.parquet"
        pl.DataFrame(
            {
                "__row_nr__": [0, 1, 2],
                TOPIC_COLUMN: [1, 2, 1],
                TOPIC_DISTRIBUTION_COLUMN: pl.Series(
                    TOPIC_DISTRIBUTION_COLUMN,
                    distribution,
                    dtype=topic_distribution_dtype(2),
                ),
            }
        ).write_parquet(path)
        assignment_paths[str(node_id)] = str(path)
    meanings_path = tmp_path / "meanings.parquet"
    pl.DataFrame(
        {TOPIC_COLUMN: [1, 2], TOPIC_MEANING_COLUMN: [["old"], ["other"]]},
        schema={TOPIC_COLUMN: pl.Int64, TOPIC_MEANING_COLUMN: pl.List(pl.String)},
    ).write_parquet(meanings_path)
    progress_updates: list[tuple[float, str]] = []

    result = run_topic_modeling_data_block_creation(
        input_snapshot_dir=str(snapshot_dir),
        output_dir=str(tmp_path / "output"),
        request_payload={
            "kind": "topic_modeling_data_block_creation",
            "node_ids": [str(first_id), str(second_id)],
            "selected_columns": {
                str(first_id): ["text"],
                str(second_id): [],
            },
            "new_node_names": {
                str(first_id): "First topics",
                str(second_id): "Second topics",
            },
            "topic_ids": [1],
            "topic_meanings_override": [{"topic_id": 1, "words": ["new"]}],
        },
        assignment_paths=assignment_paths,
        topic_meanings_path=str(meanings_path),
        progress_callback=lambda progress, message: progress_updates.append(
            (progress, message)
        ),
    )

    assert [item["source_node_id"] for item in result["outputs"]] == [
        str(first_id),
        str(second_id),
    ]
    first = result["outputs"][0]
    data = pl.read_parquet(first["topic_data"]["parquet_path"])
    assert data.columns == [
        "text",
        TOPIC_TOP1_COLUMN,
        TOPIC_DISTRIBUTION_OUTPUT_COLUMN,
    ]
    assert data["text"].to_list() == ["zero", "two"]
    output_dtype = data.schema[TOPIC_DISTRIBUTION_OUTPUT_COLUMN]
    assert isinstance(output_dtype, pl.Extension)
    assert output_dtype.ext_name() == "org.ldaca.wordflow.topic_distribution.v1"
    second_data = pl.read_parquet(result["outputs"][1]["topic_data"]["parquet_path"])
    assert second_data.columns == [
        TOPIC_TOP1_COLUMN,
        TOPIC_DISTRIBUTION_OUTPUT_COLUMN,
    ]
    assert [progress for progress, _message in progress_updates] == [
        pytest.approx(0.475),
        pytest.approx(0.95),
    ]
    assert all(progress < 1.0 for progress, _message in progress_updates)
    meanings = pl.read_parquet(first["topic_meanings"]["parquet_path"])
    assert meanings.to_dicts() == [
        {TOPIC_COLUMN: 1, TOPIC_MEANING_COLUMN: ["new"]}
    ]
