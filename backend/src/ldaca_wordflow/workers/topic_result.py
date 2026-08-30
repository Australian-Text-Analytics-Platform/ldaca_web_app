"""Result construction for the topic-modeling worker.

Consumes native Topic outcomes and builds the compact Result projection used by
the API and frontend. Complete row distributions are materialized separately
by Topic Data Block Creation.

Used by:
- ``_compute_topic_payload`` in ``topic_modeling`` for result building.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..analysis.topic_inclusion import topic_inclusion_descriptor
from ..analysis.topic_projection import TopicNodeInfo
from .topic_types import _SampledTopicCorpora

def _distribution_by_doc_index(
    documents: list[dict[str, Any]], total_docs: int, topic_ids: list[int]
) -> list[list[dict[str, Any]]]:
    """Flatten Rust ``documents[]`` into per-doc topic-distribution lists.

    Extracts the soft ``topic_distribution``
    (``[{topic_id, proportion}, ...]``) for Topic Data Block Creation.
    Every valid document gets exactly ``[-1, *topic_ids]`` in that order.

    Called by:
    - ``create_topic_modeling_data_blocks_worker`` in ``topic_modeling``.
    """
    expected_ids = [-1, *topic_ids]
    expected_set = set(expected_ids)
    empty = [
        {"topic_id": topic_id, "proportion": 0.0} for topic_id in expected_ids
    ]
    distributions = [[dict(entry) for entry in empty] for _ in range(total_docs)]
    for doc in documents:
        try:
            doc_index = int(doc["doc_index"])
        except KeyError, TypeError, ValueError:
            continue
        if not (0 <= doc_index < total_docs):
            continue
        entries = doc.get("topic_distribution") or []
        normalized: dict[int, float] = {}
        for entry in entries:
            try:
                topic_id = int(entry["topic_id"])
                proportion = float(entry["proportion"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError("Topic Distribution entry is malformed") from exc
            if topic_id not in expected_set:
                raise ValueError("Topic Distribution contains an unknown topic id")
            if topic_id in normalized:
                raise ValueError("Topic Distribution contains a duplicate topic id")
            normalized[topic_id] = proportion
        distributions[doc_index] = [
            {"topic_id": topic_id, "proportion": normalized.get(topic_id, 0.0)}
            for topic_id in expected_ids
        ]
    return distributions


def _build_empty_topic_payload(
    *,
    sampled: _SampledTopicCorpora,
    node_infos: list[TopicNodeInfo],
    artifact_root: Path,
    artifact_prefix: str,
) -> dict[str, Any]:
    """Build a valid but empty topic result when there are no documents to
    model (e.g. all sampled corpora reduced to zero documents).

    Called by:
    - ``_compute_topic_payload`` in ``topic_modeling``.
    """
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
        "clustering_context": {
            "version": 1,
            "artifact": None,
            "source_row_indices": sampled.active_corpora_indices,
        },
        "segment_count": 0,
        "truncated_segment_count": 0,
    }
