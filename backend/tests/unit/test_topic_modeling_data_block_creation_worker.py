from __future__ import annotations

import uuid
from pathlib import Path

import polars as pl
import pytest

from ldaca_wordflow.analysis.generated_columns import (
    TOPIC_COLUMN,
    TOPIC_DISTRIBUTION_OUTPUT_COLUMN,
    TOPIC_MEANING_COLUMN,
    TOPIC_TOP1_COLUMN,
)
from ldaca_wordflow.domain.workspace import Node, SourceProvenance, Workspace
from ldaca_wordflow.workers.input_snapshots import create_worker_input_snapshot
from ldaca_wordflow.workers.topic_modeling import run_topic_modeling_data_block_creation


def test_topic_modeling_data_block_creation_publishes_ordered_data_and_meanings(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
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
            {"topic_id": 0, "proportion": 0.6},
            {"topic_id": 1, "proportion": 0.4},
        ],
        [
            {"topic_id": -1, "proportion": 0.0},
            {"topic_id": 0, "proportion": 0.0},
            {"topic_id": 1, "proportion": 1.0},
        ],
    ]
    projected_documents = [
        {
            "doc_index": index,
            "dominant_topic": [1, 0, 1][index % 3],
            "topic_distribution": distribution[index % 3],
        }
        for index in range(6)
    ]
    monkeypatch.setattr(
        "ldaca_wordflow.workers.topic_pipeline._project_rust_topic_modeling",
        lambda **_kwargs: {
            "documents": projected_documents,
            "topics": [
                {"id": 0, "representative_words": [{"word": "old"}]},
                {"id": 1, "representative_words": [{"word": "other"}]},
            ],
        },
    )
    context_path = tmp_path / "context.msgpack.zst"
    context_path.write_bytes(b"context")
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
            "cluster_count": 2,
            "top_n_topics": 2,
            "topic_meanings_override": [{"topic_id": 1, "words": ["new"]}],
        },
        clustering_context_path=str(context_path),
        source_projection={
            str(first_id): {"row_indices": [0, 1, 2], "offset": 0, "size": 3},
            str(second_id): {"row_indices": [0, 1, 2], "offset": 3, "size": 3},
        },
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
    assert data["text"].to_list() == ["zero", "one", "two"]
    assert data[TOPIC_TOP1_COLUMN].to_list() == [1, 0, 1]
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
        {TOPIC_COLUMN: 0, TOPIC_MEANING_COLUMN: ["old"]},
        {TOPIC_COLUMN: 1, TOPIC_MEANING_COLUMN: ["new"]}
    ]
    assert first["topic_data"]["data_block"]["provenance"]["operation"] == {
        "kind": "topic_modeling_data_block_creation",
        "role": "topic_data",
        "cluster_count": 2,
        "top_n_topics": 2,
    }
    assert first["topic_data"]["data_block"]["color"] is None
    assert first["topic_meanings"]["data_block"]["color"] is None
