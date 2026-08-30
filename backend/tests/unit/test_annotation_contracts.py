"""Shared annotation value-object contract tests."""

from __future__ import annotations

import uuid
from typing import Any, cast

import pytest
from pydantic import ValidationError

from ldaca_wordflow.domain import AnnotationClass as DomainAnnotationClass
from ldaca_wordflow.domain.workspace import (
    AnnotationAnalysisRequest,
    AnnotationAnalysisSubmission,
    AnnotationRunAllAnalysisRequest,
    AnnotationRunAllSubmission,
    analysis_input_ids,
    analysis_snapshot_input_ids,
    persisted_submission,
)
from ldaca_wordflow.models.annotations import (
    AnnotationModelsRequest,
)


def _classes() -> list[DomainAnnotationClass]:
    return [
        DomainAnnotationClass(name="Relevant", description="Keep"),
        DomainAnnotationClass(name="relevant", description="Duplicate"),
    ]


def test_annotation_class_is_one_shared_strict_value_contract() -> None:
    annotation_class = DomainAnnotationClass(name="  Relevant  ")
    assert annotation_class.name == "Relevant"
    assert annotation_class.description == ""

    with pytest.raises(ValidationError):
        DomainAnnotationClass.model_validate({"name": "Relevant", "unknown": True})
    with pytest.raises(ValidationError):
        cast(Any, annotation_class).name = "Changed"


def test_analysis_request_rejects_duplicate_class_names() -> None:
    with pytest.raises(ValidationError, match="class names must be unique"):
        AnnotationAnalysisRequest(
            node_id=uuid.uuid4(),
            text_column="text",
            annotation_column="class",
            class_node_id=uuid.uuid4(),
            class_column="class",
            description_column="description",
            classes=_classes(),
            provider_configuration_id=uuid.uuid4(),
            provider="openai",
            model="model",
            instruction="Classify the text",
        )


def test_analysis_request_defaults_example_sampling_settings() -> None:
    request = AnnotationAnalysisRequest(
        node_id=uuid.uuid4(),
        text_column="text",
        annotation_column="class",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[DomainAnnotationClass(name="Relevant")],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="model",
        instruction="Classify the text",
    )

    assert request.max_examples_per_class == 10
    assert request.example_sampling_method == "random"
    assert request.example_random_seed == 0


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("max_examples_per_class", 0),
        ("example_sampling_method", "middle_n"),
        ("example_random_seed", -1),
    ],
)
def test_analysis_request_rejects_invalid_example_sampling_settings(
    field: str,
    value: object,
) -> None:
    payload = {
        "node_id": uuid.uuid4(),
        "text_column": "text",
        "annotation_column": "class",
        "class_node_id": uuid.uuid4(),
        "class_column": "class",
        "description_column": "description",
        "classes": [DomainAnnotationClass(name="Relevant")],
        "provider_configuration_id": uuid.uuid4(),
        "provider": "openai",
        "model": "model",
        "instruction": "Classify the text",
        field: value,
    }

    with pytest.raises(ValidationError):
        AnnotationAnalysisRequest.model_validate(payload)


@pytest.mark.parametrize("correction_column", ["text", "class"])
def test_analysis_request_rejects_overlapping_correction_column(
    correction_column: str,
) -> None:
    with pytest.raises(ValidationError, match="correction column must differ"):
        AnnotationAnalysisRequest(
            node_id=uuid.uuid4(),
            text_column="text",
            annotation_column="class",
            correction_column=correction_column,
            class_node_id=uuid.uuid4(),
            class_column="class",
            description_column="description",
            classes=[DomainAnnotationClass(name="Relevant")],
            provider_configuration_id=uuid.uuid4(),
            provider="openai",
            model="model",
            instruction="Classify the text",
        )


def test_annotation_submission_persists_only_the_safe_provider_snapshot() -> None:
    configuration_id = uuid.UUID("8edb7484-4b45-4834-bf67-ef113a834fb9")
    submission = AnnotationAnalysisSubmission(
        node_id=uuid.UUID("830961ae-6712-4cd9-872c-258f5255177f"),
        text_column="text",
        annotation_column="class",
        correction_column="reviewed_class",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[DomainAnnotationClass(name="Relevant")],
        provider_configuration_id=configuration_id,
        provider="custom",
        provider_base_url="http://localhost:8080/v1/",
        model="local-model",
        instruction="Classify the text",
        max_retries_per_batch=4,
        max_examples_per_class=7,
        example_sampling_method="last_n",
        example_random_seed=42,
        api_key="request-secret",
    )

    persisted = persisted_submission(submission)

    assert isinstance(persisted, AnnotationAnalysisRequest)
    assert persisted.provider_configuration_id == configuration_id
    assert persisted.provider == "custom"
    assert persisted.provider_base_url == "http://localhost:8080/v1"
    assert persisted.correction_column == "reviewed_class"
    assert persisted.max_retries_per_batch == 4
    assert persisted.max_examples_per_class == 7
    assert persisted.example_sampling_method == "last_n"
    assert persisted.example_random_seed == 42
    assert "request-secret" not in persisted.model_dump_json()


@pytest.mark.parametrize("max_retries", [-1, 11])
def test_analysis_request_rejects_out_of_range_batch_retries(max_retries: int) -> None:
    with pytest.raises(ValidationError):
        AnnotationAnalysisRequest(
            node_id=uuid.uuid4(),
            text_column="text",
            annotation_column="class",
            class_node_id=uuid.uuid4(),
            class_column="class",
            description_column="description",
            classes=[DomainAnnotationClass(name="Relevant")],
            provider_configuration_id=uuid.uuid4(),
            provider="openai",
            model="model",
            instruction="Classify the text",
            max_retries_per_batch=max_retries,
        )


@pytest.mark.parametrize("batch_size", [0, 101])
def test_run_all_request_rejects_out_of_range_batch_size(batch_size: int) -> None:
    source = AnnotationAnalysisRequest(
        node_id=uuid.uuid4(),
        text_column="text",
        annotation_column="class",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[DomainAnnotationClass(name="Relevant")],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="model",
        instruction="Classify the text",
    )
    with pytest.raises(ValidationError):
        AnnotationRunAllAnalysisRequest(
            source=source,
            batch_size=batch_size,
        )


def test_run_all_submission_owns_batching_and_persists_without_secret() -> None:
    source = AnnotationAnalysisRequest(
        node_id=uuid.uuid4(),
        text_column="text",
        annotation_column="class",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[DomainAnnotationClass(name="Relevant")],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="model",
        instruction="Classify the text",
    )
    submission = AnnotationRunAllSubmission(
        source=source,
        batch_size=17,
        processing_mode="fill_missing",
        api_key="request-secret",
    )

    request = persisted_submission(submission)

    assert isinstance(request, AnnotationRunAllAnalysisRequest)
    assert request.batch_size == 17
    assert request.processing_mode == "fill_missing"
    assert request.source.max_retries_per_batch == 2
    assert "request-secret" not in request.model_dump_json()


def test_preview_request_rejects_run_all_only_fields() -> None:
    payload = {
        "node_id": str(uuid.uuid4()),
        "text_column": "text",
        "annotation_column": "class",
        "class_node_id": str(uuid.uuid4()),
        "class_column": "class",
        "description_column": "description",
        "classes": [{"name": "Relevant"}],
        "provider_configuration_id": str(uuid.uuid4()),
        "provider": "openai",
        "model": "model",
        "instruction": "Classify the text",
        "batch_size": 20,
    }

    with pytest.raises(ValidationError):
        AnnotationAnalysisRequest.model_validate(payload)


def test_annotation_snapshot_excludes_embedded_class_data_block() -> None:
    source_id = uuid.uuid4()
    class_id = uuid.uuid4()
    example_id = uuid.uuid4()
    request = AnnotationAnalysisRequest(
        node_id=source_id,
        text_column="text",
        annotation_column="class",
        class_node_id=class_id,
        class_column="class",
        description_column="description",
        example_node_id=example_id,
        example_text_column="text",
        example_annotation_column="class",
        classes=[DomainAnnotationClass(name="Relevant")],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="model",
        instruction="Classify the text",
    )

    assert analysis_input_ids(request) == (source_id, class_id, example_id)
    assert analysis_snapshot_input_ids(request) == (source_id, example_id)
    assert analysis_snapshot_input_ids(
        AnnotationRunAllAnalysisRequest(source=request)
    ) == (source_id, example_id)


def test_analysis_and_discovery_share_the_safe_provider_snapshot_contract() -> None:
    configuration_id = uuid.UUID("1fe3bfd6-cb0f-4108-a954-24cad5deae20")
    analysis = AnnotationAnalysisRequest(
        node_id=uuid.uuid4(),
        text_column="text",
        annotation_column="class",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[DomainAnnotationClass(name="Relevant")],
        provider_configuration_id=configuration_id,
        provider="openrouter",
        model="model",
        instruction="Classify the text",
    )
    discovery = AnnotationModelsRequest(
        provider_configuration_id=configuration_id,
        provider="custom",
        provider_base_url="http://localhost:8080/v1/",
    )

    assert analysis.provider_configuration_id == configuration_id
    assert discovery.provider_base_url == "http://localhost:8080/v1"
    assert discovery.api_key is None
