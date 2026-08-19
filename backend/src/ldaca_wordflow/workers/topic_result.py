"""Result construction for the topic-modeling worker.

Consumes native Topic outcomes and builds the compact Result projection used by
the API and frontend. Complete row distributions are materialized separately
by Topic Data Block Creation.

Used by:
- ``_compute_topic_payload`` in ``topic_modeling`` for result building.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..analysis.topic_inclusion import (
    aggregate_topic_activations,
    topic_counts_from_activations,
    topic_inclusion_descriptor,
)
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
    node_infos: list[dict[str, Any]],
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
        "per_corpus_topic_counts": [],
        "sources": [
            {
                "node_id": str(info["node_id"]),
                "node_name": str(info.get("node_name") or info["node_id"]),
                "text_column": str(info.get("text_column") or ""),
                "original_columns": list(info.get("original_columns") or []),
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
        "meta": {"n_chunks": 0, "truncated_segment_count": 0},
    }


def _build_topic_projection_basis(
    *,
    rust_result: dict[str, Any],
    corpus_sizes: list[int],
) -> dict[str, Any]:
    """Build one complete, N-independent basis for Result count projections."""

    documents = list(rust_result.get("documents") or [])
    rust_topics = list(rust_result.get("topics") or [])
    topics: list[dict[str, Any]] = []
    for raw_topic in rust_topics:
        topic_id = int(raw_topic["id"])
        if topic_id < 0:
            continue
        words = [
            {
                "word": str(candidate["word"]),
                "occurrence_count": int(candidate["occurrence_count"]),
            }
            for candidate in raw_topic.get("representative_words") or []
            if isinstance(candidate, dict)
            and candidate.get("word")
            and int(candidate.get("occurrence_count") or 0) > 0
        ]
        topics.append(
            {
                "id": topic_id,
                "representative_words": words,
                "x": float(raw_topic.get("x") or 0.0),
                "y": float(raw_topic.get("y") or 0.0),
            }
        )
    if [topic["id"] for topic in topics] != list(range(len(topics))):
        raise ValueError("Topic ids must be contiguous and start at zero")
    return {
        "topics": topics,
        "activations": aggregate_topic_activations(
            documents,
            corpus_sizes,
            len(topics),
        ),
        "has_outlier": any(
            int(document.get("dominant_topic", -1)) == -1
            for document in documents
        ),
    }


def _encode_topic_projection_basis(basis: dict[str, Any]) -> bytes:
    """Encode one cache value with exact byte accounting."""

    return json.dumps(basis, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _decode_topic_projection_basis(payload: bytes) -> dict[str, Any]:
    """Decode and minimally validate one internal cache value."""

    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("Topic projection basis is malformed")
    if not isinstance(value.get("topics"), list) or not isinstance(
        value.get("activations"), list
    ):
        raise ValueError("Topic projection basis is incomplete")
    return value


def _build_topic_projection_payload(
    *,
    basis: dict[str, Any],
    node_infos: list[dict[str, Any]],
    corpus_sizes: list[int],
    top_n_topics: int,
) -> dict[str, Any]:
    """Build authoritative Topic JSON for one Top-N request from a full basis."""

    basis_topics = list(basis.get("topics") or [])
    topic_count = len(basis_topics)
    per_corpus_topic_counts = topic_counts_from_activations(
        basis.get("activations") or [],
        corpus_count=len(corpus_sizes),
        topic_count=topic_count,
        top_n_topics=top_n_topics,
    )
    topics: list[dict[str, Any]] = []
    for raw_topic in basis_topics:
        topic_id = int(raw_topic["id"])
        sizes = [counts.get(topic_id, 0) for counts in per_corpus_topic_counts]
        topics.append(
            {
                **raw_topic,
                "size": sizes,
                "total_size": sum(sizes),
            }
        )
    return {
        "topics": topics,
        "corpus_sizes": corpus_sizes,
        "per_corpus_topic_counts": per_corpus_topic_counts,
        "sources": [
            {
                "node_id": str(info["node_id"]),
                "node_name": str(info.get("node_name") or info["node_id"]),
                "text_column": str(info.get("text_column") or ""),
                "original_columns": list(info.get("original_columns") or []),
            }
            for info in node_infos
        ],
        "meta": {
            "embeddings_from_ctfidf": False,
            "total_topics_incl_outlier": topic_count
            + int(bool(basis.get("has_outlier"))),
        },
        "topic_inclusion": topic_inclusion_descriptor(topic_count, top_n_topics),
    }
