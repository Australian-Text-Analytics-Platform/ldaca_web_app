"""Framework-independent Topic projection construction and cache codecs."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any, cast

from .topic_inclusion import (
    aggregate_topic_activations,
    topic_counts_from_activations,
    topic_inclusion_descriptor,
)


@dataclass(frozen=True, slots=True)
class TopicNodeInfo:
    """Typed Topic source identity and schema metadata."""

    node_id: uuid.UUID
    text_column: str
    node_name: str | None = None
    original_columns: tuple[str, ...] = ()


def normalize_projected_topics(
    raw_topics: object,
    cluster_count: int,
) -> list[dict[str, Any]]:
    """Validate Topic metadata shared by native projection responses."""

    if not isinstance(raw_topics, list) or len(raw_topics) != cluster_count:
        raise ValueError("Topic projection result has invalid dimensions")
    topics: list[dict[str, Any]] = []
    for expected_id, raw_topic in enumerate(raw_topics):
        if not isinstance(raw_topic, dict):
            raise ValueError("Topic projection ids are invalid")
        topic = cast(dict[str, Any], raw_topic)
        if int(topic.get("id", -1)) != expected_id:
            raise ValueError("Topic projection ids are invalid")
        topics.append(
            {
                "id": expected_id,
                "representative_words": list(topic.get("representative_words") or []),
                "x": float(topic.get("x") or 0.0),
                "y": float(topic.get("y") or 0.0),
            }
        )
    return topics


def build_topic_projection_basis(
    *,
    rust_result: dict[str, Any],
    corpus_sizes: list[int],
) -> dict[str, Any]:
    """Build one complete, top-N-independent basis from an initial run."""

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
            any(
                int(entry.get("topic_id", -2)) == -1
                and float(entry.get("coverage", 0.0)) > 0.0
                for entry in document.get("topic_coverage") or []
            )
            for document in documents
        ),
    }


def project_rust_topic_projection_basis(
    *,
    projection_context: bytes,
    cluster_count: int,
    corpus_sizes: list[int],
) -> dict[str, Any]:
    """Project compact top-N-independent bubble-count facts in native code."""

    from polars_text import project_topic_basis

    try:
        raw_basis = project_topic_basis(
            projection_context,
            int(cluster_count),
            [int(size) for size in corpus_sizes],
        )
    except (TypeError, ValueError, RuntimeError) as exc:
        raise ValueError("Topic projection context is invalid") from exc
    if not isinstance(raw_basis, dict):
        raise ValueError("Topic projection basis is malformed")
    topics = normalize_projected_topics(raw_basis.get("topics"), cluster_count)
    raw_activations = raw_basis.get("activations")
    if not isinstance(raw_activations, list):
        raise ValueError("Topic projection basis is malformed")
    activations: list[list[int]] = []
    previous_key: tuple[int, int, int] | None = None
    for raw_activation in raw_activations:
        if not isinstance(raw_activation, list) or len(raw_activation) != 4:
            raise ValueError("Topic projection activation is malformed")
        try:
            corpus_index = int(raw_activation[0])
            topic_id = int(raw_activation[1])
            minimum_n = int(raw_activation[2])
            count = int(raw_activation[3])
        except (TypeError, ValueError) as exc:
            raise ValueError("Topic projection activation is malformed") from exc
        key = (corpus_index, topic_id, minimum_n)
        if (
            corpus_index < 0
            or corpus_index >= len(corpus_sizes)
            or topic_id < 0
            or topic_id >= cluster_count
            or minimum_n < 1
            or minimum_n > cluster_count
            or count < 1
            or (previous_key is not None and key <= previous_key)
        ):
            raise ValueError("Topic projection activation is invalid")
        activations.append([corpus_index, topic_id, minimum_n, count])
        previous_key = key
    has_outlier = raw_basis.get("has_outlier")
    if not isinstance(has_outlier, bool):
        raise ValueError("Topic projection basis is malformed")
    return {
        "topics": topics,
        "activations": activations,
        "has_outlier": has_outlier,
    }


def encode_topic_projection_basis(basis: dict[str, Any]) -> bytes:
    """Encode one cache value with exact byte accounting."""

    return json.dumps(basis, separators=(",", ":"), sort_keys=True).encode("utf-8")


def decode_topic_projection_basis(payload: bytes) -> dict[str, Any]:
    """Decode and minimally validate one internal cache value."""

    value = json.loads(payload)
    if not isinstance(value, dict):
        raise ValueError("Topic projection basis is malformed")
    if not isinstance(value.get("topics"), list) or not isinstance(
        value.get("activations"), list
    ):
        raise ValueError("Topic projection basis is incomplete")
    return value


def build_topic_projection_payload(
    *,
    basis: dict[str, Any],
    node_infos: list[TopicNodeInfo],
    corpus_sizes: list[int],
    top_n_topics: int,
) -> dict[str, Any]:
    """Build authoritative Topic JSON for one top-N request from a full basis."""

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
        "sources": [
            {
                "node_id": info.node_id,
                "node_name": info.node_name or str(info.node_id),
                "text_column": info.text_column,
                "original_columns": list(info.original_columns),
            }
            for info in node_infos
        ],
        "topic_inclusion": topic_inclusion_descriptor(topic_count, top_n_topics),
    }


__all__ = [
    "build_topic_projection_basis",
    "build_topic_projection_payload",
    "decode_topic_projection_basis",
    "encode_topic_projection_basis",
    "normalize_projected_topics",
    "project_rust_topic_projection_basis",
    "TopicNodeInfo",
]
