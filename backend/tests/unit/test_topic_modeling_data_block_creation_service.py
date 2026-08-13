from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path

import polars as pl
import pytest

from ldaca_wordflow.domain.workspace import (
    AnalysisExecutionScope,
    AnalysisKind,
    AnalysisRecord,
    DerivationInput,
    DerivationProvenance,
    Node,
    SourceProvenance,
    TopicModelingAnalysisRequest,
    TopicModelingDataBlockCreationAnalysisRequest,
    TopicModelingDataBlockCreationDerivation,
    Tab,
    Workspace,
    node_reference,
)
from ldaca_wordflow.models.analysis_results import (
    PublishedDataBlockMetadata,
    TopicModelingDataBlockCreationWorkerOutput,
    TopicModelingDataBlockCreationWorkerResult,
)
from ldaca_wordflow.services.analysis_artifacts import (
    _publish_topic_modeling_data_blocks,
)
from ldaca_wordflow.services.workspace_sql import _query_page
from ldaca_wordflow.shared.topic_types import topic_distribution_dtype


def _data_block_creation_fixture(
    tmp_path: Path,
    *,
    invalid_meanings_count: bool = False,
) -> tuple[Workspace, AnalysisRecord, TopicModelingDataBlockCreationWorkerResult, uuid.UUID]:
    source_id = uuid.uuid4()
    workspace = Workspace(name="topic Data Block Creation")
    workspace.add_node(
        Node(
            id=str(source_id),
            name="Source",
            data=pl.DataFrame({"text": ["first", "second"]}).lazy(),
            provenance=SourceProvenance(),
            document="text",
            color="#112233",
        )
    )
    created = datetime.now(UTC)
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.TOPIC_MODELING,
            name="Topic Modeling",
            timestamp=created,
        )
    )
    root = AnalysisRecord.create(
        TopicModelingAnalysisRequest(
            node_ids=[source_id],
            node_columns={source_id: "text"},
        ),
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.RUN_ALL,
        timestamp=created,
    ).start(created + timedelta(seconds=1)).succeed(
        created + timedelta(seconds=2),
        result_payload={"kind": "topic_modeling"},
    )
    workspace.add_analysis(root)
    request = TopicModelingDataBlockCreationAnalysisRequest(
        node_ids=[source_id],
        selected_columns={source_id: ["text"]},
        new_node_names={source_id: "Topic data"},
    )
    child = AnalysisRecord.create(
        request,
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.SUPPORTING,
        timestamp=created + timedelta(seconds=3),
        parent_analysis_id=root.id,
    ).start(created + timedelta(seconds=4))
    workspace.add_analysis(child)

    topic_data_id = uuid.uuid4()
    meanings_id = uuid.uuid4()
    output_dir = tmp_path / "analyses" / str(child.id) / ".execution" / "output"
    output_dir.mkdir(parents=True)
    topic_path = output_dir / f"{topic_data_id}.parquet"
    meanings_path = output_dir / f"{meanings_id}.parquet"
    pl.DataFrame(
        {
            "text": ["first"],
            "TOPIC_top1": [0],
            "TOPIC_distribution": pl.Series(
                "TOPIC_distribution",
                [
                    [
                        {"topic_id": -1, "proportion": 0.0},
                        {"topic_id": 0, "proportion": 1.0},
                    ]
                ],
                dtype=topic_distribution_dtype(1),
            ),
        }
    ).write_parquet(topic_path)
    pl.DataFrame(
        {"TOPIC_topic": [0], "TOPIC_topic_meaning": [["first"]]},
        schema={"TOPIC_topic": pl.Int64, "TOPIC_topic_meaning": pl.List(pl.String)},
    ).write_parquet(meanings_path)
    topic_provenance = DerivationProvenance(
        operation=TopicModelingDataBlockCreationDerivation(role="topic_data"),
        inputs=[
            DerivationInput(role="source", value=node_reference(str(source_id)))
        ],
    )
    meanings_provenance = DerivationProvenance(
        operation=TopicModelingDataBlockCreationDerivation(role="topic_meanings"),
        inputs=[
            DerivationInput(
                role="source", value=node_reference(str(topic_data_id))
            )
        ],
    )
    result = TopicModelingDataBlockCreationWorkerResult(
        state="successful",
        message="done",
        outputs=[
            TopicModelingDataBlockCreationWorkerOutput(
                source_node_id=source_id,
                topic_data={
                    "data_block": PublishedDataBlockMetadata(
                        id=topic_data_id,
                        name="Topic data",
                        provenance=topic_provenance,
                        document="text",
                        color="#112233",
                    ),
                    "parquet_path": str(topic_path),
                    "output_columns": [
                        "text",
                        "TOPIC_top1",
                        "TOPIC_distribution",
                    ],
                    "record_count": 1,
                },
                topic_meanings={
                    "data_block": PublishedDataBlockMetadata(
                        id=meanings_id,
                        name="Topic data topic meanings",
                        provenance=meanings_provenance,
                        color="#112233",
                    ),
                    "parquet_path": str(meanings_path),
                    "output_columns": ["TOPIC_topic", "TOPIC_topic_meaning"],
                    "record_count": 2 if invalid_meanings_count else 1,
                },
            )
        ],
    )
    return workspace, child, result, source_id


def test_topic_modeling_data_block_creation_preserves_semantic_pair_and_parent_order(
    tmp_path: Path,
) -> None:
    workspace, child, result, source_id = _data_block_creation_fixture(tmp_path)

    stored = _publish_topic_modeling_data_blocks(
        tmp_path / "analyses" / str(child.id),
        workspace,
        tmp_path,
        child,
        result,
        10_000_000,
    )

    assert len(stored.output_node_ids) == 2
    semantic = stored.outputs[0]
    assert semantic.source_node_id == source_id
    assert stored.output_node_ids == [
        semantic.topic_data_node_id,
        semantic.topic_meanings_node_id,
    ]
    assert workspace.nodes[str(semantic.topic_data_node_id)].parents[0].id == str(
        source_id
    )
    assert workspace.nodes[
        str(semantic.topic_meanings_node_id)
    ].parents[0].id == str(semantic.topic_data_node_id)

    topic_data = workspace.nodes[str(semantic.topic_data_node_id)]
    page = _query_page(
        [topic_data],
        f'SELECT * FROM "{topic_data.id}"',
        page=1,
        page_size=20,
    )
    ipc_dtype = pl.read_ipc_stream(BytesIO(page.content)).schema[
        "TOPIC_distribution"
    ]
    assert isinstance(ipc_dtype, pl.Extension)
    assert ipc_dtype.ext_name() == "org.ldaca.wordflow.topic_distribution.v1"


def test_topic_modeling_data_block_creation_rolls_back_every_output_on_failure(
    tmp_path: Path,
) -> None:
    workspace, child, result, source_id = _data_block_creation_fixture(
        tmp_path,
        invalid_meanings_count=True,
    )

    with pytest.raises(ValueError, match="count"):
        _publish_topic_modeling_data_blocks(
            tmp_path / "analyses" / str(child.id),
            workspace,
            tmp_path,
            child,
            result,
            10_000_000,
        )

    assert set(workspace.nodes) == {str(source_id)}
    assert list((tmp_path / "data").glob("*.parquet")) == []
