"""Result construction for the topic-modeling worker."""

from __future__ import annotations

from typing import Any

from ..analysis.topic_inclusion import topic_inclusion_descriptor
from ..analysis.topic_projection import TopicNodeInfo
from .topic_types import _SampledTopicCorpora


def _coverage_by_doc_index(
    documents: list[dict[str, Any]], total_docs: int, topic_ids: list[int]
) -> list[list[dict[str, Any]]]:
    """Return canonical per-document Topic Coverage for Data Block Creation."""

    expected_ids = [-1, *topic_ids]
    expected_set = set(expected_ids)
    empty = [{"topic_id": topic_id, "coverage": 0.0} for topic_id in expected_ids]
    rows = [[dict(entry) for entry in empty] for _ in range(total_docs)]
    for document in documents:
        try:
            doc_index = int(document["doc_index"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 0 <= doc_index < total_docs:
            continue
        normalized: dict[int, float] = {}
        for entry in document.get("topic_coverage") or []:
            try:
                topic_id = int(entry["topic_id"])
                coverage = float(entry["coverage"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError("Topic Coverage entry is malformed") from exc
            if topic_id not in expected_set:
                raise ValueError("Topic Coverage contains an unknown Topic id")
            if topic_id in normalized:
                raise ValueError("Topic Coverage contains a duplicate Topic id")
            normalized[topic_id] = coverage
        rows[doc_index] = [
            {"topic_id": topic_id, "coverage": normalized.get(topic_id, 0.0)}
            for topic_id in expected_ids
        ]
    return rows


def _build_empty_topic_payload(
    *,
    sampled: _SampledTopicCorpora,
    node_infos: list[TopicNodeInfo],
) -> dict[str, Any]:
    """Build a valid no-topic result when there are no source documents."""

    return {
        "topics": [],
        "corpus_sizes": sampled.corpus_sizes,
        "sources": [
            {
                "node_id": info.node_id,
                "node_name": info.node_name or str(info.node_id),
                "text_column": info.text_column,
                "original_columns": list(info.original_columns),
            }
            for info in node_infos
        ],
        "clustering": {
            "cluster_count": 0,
            "min_cluster_count": 0,
            "max_cluster_count": 0,
            "default_cluster_count": 0,
            "adjustable": False,
        },
        "topic_inclusion": topic_inclusion_descriptor(0),
        "projection_context": {
            "version": 2,
            "artifact": None,
            "source_row_indices": sampled.active_corpora_indices,
        },
        "segment_count": 0,
    }
