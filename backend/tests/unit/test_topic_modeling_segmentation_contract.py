from __future__ import annotations

import uuid

import pytest
from ldaca_wordflow.domain.workspace import (
    TopicModelingAnalysisRequest,
    TopicSegmentationMethod,
)
from pydantic import ValidationError


def _request(**overrides: object) -> TopicModelingAnalysisRequest:
    node_id = uuid.uuid4()
    return TopicModelingAnalysisRequest.model_validate(
        {
            "node_ids": [node_id],
            "node_columns": {node_id: "document"},
            **overrides,
        }
    )


def test_legacy_topic_modeling_request_defaults_to_automatic_segments() -> None:
    request = _request()

    assert (request.segmentation_method, request.max_segment_tokens) == (
        TopicSegmentationMethod.AUTOMATIC,
        256,
    )


@pytest.mark.parametrize("max_segment_tokens", [31, 511])
def test_topic_modeling_request_rejects_segment_caps_outside_model_window(
    max_segment_tokens: int,
) -> None:
    with pytest.raises(ValidationError):
        _request(max_segment_tokens=max_segment_tokens)


def test_topic_modeling_request_rejects_unknown_segmentation_method() -> None:
    with pytest.raises(ValidationError):
        _request(segmentation_method="fixed_length")
