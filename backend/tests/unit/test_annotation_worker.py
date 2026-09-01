"""Annotation worker publication tests for fatal and row-local failures."""

from __future__ import annotations

import uuid

import polars as pl

from ldaca_wordflow.domain import AnnotationClass
from ldaca_wordflow.domain.workspace import (
    AnnotationAnalysisRequest,
    AnnotationRunAllAnalysisRequest,
)
from ldaca_wordflow.infrastructure.providers.annotation_ai import (
    AnnotationAiError,
    AnnotationAllResult,
)
from ldaca_wordflow.workers.annotation import run_annotation_analysis


def _request(node_id: uuid.UUID) -> dict[str, object]:
    source = AnnotationAnalysisRequest(
        node_id=node_id,
        text_column="text",
        annotation_column="annotation",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[AnnotationClass(name="positive")],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="some-model",
        instruction="Classify the text",
    )
    return AnnotationRunAllAnalysisRequest(
        source=source,
        processing_mode="reprocess_all",
    ).model_dump(mode="json")


def test_row_failure_mask_preserves_failed_rows_but_successful_null_clears(
    tmp_path,
    worker_snapshot,
    monkeypatch,
) -> None:
    node_id = uuid.uuid4()
    snapshot = worker_snapshot(
        node_id=str(node_id),
        columns={
            "text": ["one", "two", "three"],
            "annotation": ["old-one", "old-two", "old-three"],
        },
    )
    output = tmp_path / "output"
    output.mkdir()

    async def fake_annotate_all(*_args, **_kwargs):
        return AnnotationAllResult(
            labels=[None, None, "positive"],
            failed_rows=[False, True, False],
            failed_batch_count=1,
            failed_row_count=1,
        )

    monkeypatch.setattr(
        "ldaca_wordflow.workers.annotation.annotate_all",
        fake_annotate_all,
    )

    result = run_annotation_analysis(
        input_snapshot_dir=str(snapshot),
        output_dir=str(output),
        request_payload=_request(node_id),
        api_key="captured-key",
    )

    assert result["state"] == "successful"
    frame = pl.read_parquet(output / "annotation-run-all.parquet")
    assert frame["annotation"].to_list() == [None, "old-two", "positive"]


def test_fatal_provider_failure_returns_diagnostic_envelope_without_artifact(
    tmp_path,
    worker_snapshot,
    monkeypatch,
) -> None:
    node_id = uuid.uuid4()
    snapshot = worker_snapshot(
        node_id=str(node_id),
        columns={"text": ["one"], "annotation": [None]},
    )
    output = tmp_path / "output"
    output.mkdir()

    async def fail_annotate_all(*_args, **_kwargs):
        raise AnnotationAiError(
            "private SDK response containing secret material",
            code="annotation_provider_authentication_failed",
        )

    monkeypatch.setattr(
        "ldaca_wordflow.workers.annotation.annotate_all",
        fail_annotate_all,
    )

    result = run_annotation_analysis(
        input_snapshot_dir=str(snapshot),
        output_dir=str(output),
        request_payload=_request(node_id),
        api_key="captured-key",
    )

    assert result == {
        "state": "failed",
        "failure": {
            "code": "annotation_provider_authentication_failed",
            "message": "AnnotationAiError: private SDK response containing secret material",
        },
    }
    assert list(output.iterdir()) == []
    assert "Traceback" not in str(result)
