from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import polars as pl
import pytest

from ldaca_wordflow.domain.workspace import (
    AnalysisExecutionScope,
    AnalysisKind,
    AnalysisRecord,
    Node,
    SequentialAnalysisRequest,
    SequentialDataBlockCreationAnalysisRequest,
    SequentialDataBlockCreationSource,
    Tab,
    Workspace,
)
from ldaca_wordflow.models.analysis_results import (
    CompleteTableIdentity,
    DataBlockCreationWorkerResult,
    SequentialSourceDescriptor,
    SequentialStoredResult,
    StoredArtifactIdentity,
)
from ldaca_wordflow.services.analysis_artifacts import _create_result_data_blocks
from ldaca_wordflow.workers.result_data_block_creation import (
    run_result_data_block_creation,
)


def _sequential_data_block_creation_fixture(
    tmp_path: Path,
    *,
    document_column: str | None,
) -> tuple[Workspace, AnalysisRecord, dict[str, Any], uuid.UUID]:
    source_id = uuid.uuid4()
    columns = {"when": [1, 2]}
    selected_columns = ["when"]
    if document_column is not None:
        columns[document_column] = ["first", "second"]
        selected_columns.append(document_column)

    workspace = Workspace(name="Trends Data Block Creation")
    workspace.add_node(
        Node(
            id=source_id,
            name="Events",
            data=pl.DataFrame(columns).lazy(),
            document=document_column,
        )
    )
    created = datetime.now(UTC)
    tab = workspace.add_tab(
        Tab.create(
            kind=AnalysisKind.SEQUENTIAL,
            name="Trends",
            timestamp=created,
        )
    )
    parent = (
        AnalysisRecord.create(
            SequentialAnalysisRequest(
                node_id=source_id,
                time_column="when",
                frequency="daily",
            ),
            tab_id=tab.id,
            execution_scope=AnalysisExecutionScope.RUN_ALL,
            timestamp=created,
        )
        .start(created + timedelta(seconds=1))
        .succeed(
            created + timedelta(seconds=2),
            result_payload=SequentialStoredResult(
                table=CompleteTableIdentity(
                    table_id="result",
                    artifact=StoredArtifactIdentity(name="result.arrow"),
                ),
                publication_artifact=StoredArtifactIdentity(name="publication.parquet"),
                source=SequentialSourceDescriptor(
                    node_id=source_id,
                    node_name="Events",
                    document_column=document_column,
                    columns=selected_columns,
                    period_count=2,
                    group_count=1,
                ),
            ).model_dump(mode="json"),
        )
    )
    workspace.add_analysis(parent)
    child = AnalysisRecord.create(
        SequentialDataBlockCreationAnalysisRequest(
            source=SequentialDataBlockCreationSource(
                source_node_id=source_id,
                selected_columns=selected_columns,
                new_node_name="Selected trends",
                selected_period_indices=[1],
            )
        ),
        tab_id=tab.id,
        execution_scope=AnalysisExecutionScope.SUPPORTING,
        timestamp=created + timedelta(seconds=3),
        parent_analysis_id=parent.id,
    ).start(created + timedelta(seconds=4))
    workspace.add_analysis(child)

    publication_path = tmp_path / "publication.parquet"
    publication_columns = {
        **columns,
        "__wordflow_trends_period_index": [0, 1],
        "__wordflow_trends_group_index": [0, 0],
    }
    pl.DataFrame(publication_columns).write_parquet(publication_path)
    output_dir = tmp_path / "analyses" / str(child.id) / ".execution" / "output"
    output_dir.mkdir(parents=True)
    result = run_result_data_block_creation(
        artifact_dir=str(output_dir),
        request_payload=child.request.model_dump(mode="json"),
        result_paths={source_id: str(publication_path)},
        document_columns={source_id: document_column},
    )
    return workspace, child, result, source_id


@pytest.mark.parametrize("document_column", ["text", None])
def test_sequential_data_block_creation_publishes_valid_output(
    tmp_path: Path,
    document_column: str | None,
) -> None:
    workspace, child, raw_result, source_id = _sequential_data_block_creation_fixture(
        tmp_path,
        document_column=document_column,
    )

    stored = _create_result_data_blocks(
        tmp_path / "analyses" / str(child.id),
        workspace,
        tmp_path,
        child,
        DataBlockCreationWorkerResult.model_validate(raw_result),
        10_000_000,
    )

    output_id = stored.output_node_ids[0]
    output = workspace.nodes[output_id]
    assert stored.outputs[0].source_node_id == source_id
    assert output.name == "Selected trends"
    assert output.document == document_column
    assert output.color is None
    assert output.parents[0].id == source_id
    assert isinstance(child.request, SequentialDataBlockCreationAnalysisRequest)
    assert output.data.collect_schema().names() == child.request.source.selected_columns
    assert output.data.collect().height == 1


def test_sequential_data_block_creation_rejects_wrong_document_identity(
    tmp_path: Path,
) -> None:
    workspace, child, raw_result, source_id = _sequential_data_block_creation_fixture(
        tmp_path,
        document_column="text",
    )
    raw_result["outputs"][0]["data"]["data_block"]["document"] = "when"

    with pytest.raises(ValueError, match="metadata"):
        _create_result_data_blocks(
            tmp_path / "analyses" / str(child.id),
            workspace,
            tmp_path,
            child,
            DataBlockCreationWorkerResult.model_validate(raw_result),
            10_000_000,
        )

    assert set(workspace.nodes) == {source_id}
    assert list((tmp_path / "data").glob("*.parquet")) == []
