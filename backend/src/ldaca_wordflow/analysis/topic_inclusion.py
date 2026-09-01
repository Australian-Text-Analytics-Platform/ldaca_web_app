"""Top-N real-Topic membership derived from complete Topic Coverage."""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Iterable, Sequence
from typing import Any


def topic_inclusion_descriptor(
    topic_count: int,
    top_n_topics: int | None = None,
) -> dict[str, Any]:
    """Return the applied/default/bounds contract for one projected Topic count."""

    if topic_count < 0:
        raise ValueError("Topic count cannot be negative")
    minimum = 0 if topic_count == 0 else 1
    default = min(2, topic_count)
    applied = default if top_n_topics is None else top_n_topics
    if applied < minimum or applied > topic_count:
        raise ValueError("Top topics per row is outside the supported range")
    return {
        "top_n_topics": applied,
        "min_top_n_topics": minimum,
        "max_top_n_topics": topic_count,
        "default_top_n_topics": default,
        "adjustable": topic_count > 1,
    }


def topic_activation_thresholds(
    coverage_entries: Iterable[dict[str, Any]],
    topic_count: int,
) -> list[tuple[int, int]]:
    """Return ``(topic_id, minimum_n)`` for every positive real Topic.

    Topics with equal shares receive the same threshold, so selecting the first
    member of a tied rank includes the complete tie group.
    """

    coverage_by_topic: dict[int, float] = {}
    for entry in coverage_entries:
        try:
            topic_id = int(entry["topic_id"])
            coverage = float(entry["coverage"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Topic Coverage entry is malformed") from exc
        if topic_id < -1 or topic_id >= topic_count:
            raise ValueError("Topic Coverage contains an unknown topic id")
        if topic_id in coverage_by_topic:
            raise ValueError("Topic Coverage contains a duplicate topic id")
        if not math.isfinite(coverage) or coverage < 0:
            raise ValueError("Topic Coverage value is invalid")
        coverage_by_topic[topic_id] = coverage

    ranked = sorted(
        (
            (topic_id, coverage)
            for topic_id, coverage in coverage_by_topic.items()
            if topic_id >= 0 and coverage > 0
        ),
        key=lambda item: (-item[1], item[0]),
    )
    thresholds: list[tuple[int, int]] = []
    index = 0
    while index < len(ranked):
        coverage = ranked[index][1]
        group_end = index + 1
        while group_end < len(ranked) and ranked[group_end][1] == coverage:
            group_end += 1
        minimum_n = index + 1
        thresholds.extend(
            (topic_id, minimum_n) for topic_id, _ in ranked[index:group_end]
        )
        index = group_end
    return thresholds


def top_topic_ids(
    coverage_entries: Iterable[dict[str, Any]],
    topic_count: int,
    top_n_topics: int,
) -> set[int]:
    """Return real Topics included by one row's Top-N-with-ties projection."""

    topic_inclusion_descriptor(topic_count, top_n_topics)
    return {
        topic_id
        for topic_id, minimum_n in topic_activation_thresholds(
            coverage_entries,
            topic_count,
        )
        if minimum_n <= top_n_topics
    }


def aggregate_topic_activations(
    documents: Sequence[dict[str, Any]],
    corpus_sizes: Sequence[int],
    topic_count: int,
) -> list[list[int]]:
    """Aggregate complete row rankings as compact corpus/topic/N activations."""

    total_docs = sum(corpus_sizes)
    if len(documents) != total_docs:
        raise ValueError("Topic projection documents do not align with corpus sizes")
    corpus_indices: list[int] = []
    for corpus_index, size in enumerate(corpus_sizes):
        if size < 0:
            raise ValueError("Topic corpus size cannot be negative")
        corpus_indices.extend([corpus_index] * size)

    counts: Counter[tuple[int, int, int]] = Counter()
    seen_indices: set[int] = set()
    for document in documents:
        try:
            document_index = int(document["doc_index"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Topic projection document index is invalid") from exc
        if document_index < 0 or document_index >= total_docs:
            raise ValueError("Topic projection document index is outside the corpus")
        if document_index in seen_indices:
            raise ValueError("Topic projection document index is duplicated")
        seen_indices.add(document_index)
        for topic_id, minimum_n in topic_activation_thresholds(
            document.get("topic_coverage") or [],
            topic_count,
        ):
            counts[(corpus_indices[document_index], topic_id, minimum_n)] += 1
    if len(seen_indices) != total_docs:
        raise ValueError("Topic projection document indices are incomplete")
    return [
        [corpus_index, topic_id, minimum_n, count]
        for (corpus_index, topic_id, minimum_n), count in sorted(counts.items())
    ]


def topic_counts_from_activations(
    activations: Iterable[Sequence[int]],
    *,
    corpus_count: int,
    topic_count: int,
    top_n_topics: int,
) -> list[dict[int, int]]:
    """Derive authoritative per-corpus counts for one requested Top N."""

    topic_inclusion_descriptor(topic_count, top_n_topics)
    counts = [dict[int, int]() for _ in range(corpus_count)]
    for activation in activations:
        if len(activation) != 4:
            raise ValueError("Topic activation is malformed")
        corpus_index, topic_id, minimum_n, count = map(int, activation)
        if (
            corpus_index < 0
            or corpus_index >= corpus_count
            or topic_id < 0
            or topic_id >= topic_count
            or minimum_n < 1
            or minimum_n > topic_count
            or count < 1
        ):
            raise ValueError("Topic activation is invalid")
        if minimum_n <= top_n_topics:
            counts[corpus_index][topic_id] = (
                counts[corpus_index].get(topic_id, 0) + count
            )
    return counts


__all__ = [
    "aggregate_topic_activations",
    "top_topic_ids",
    "topic_activation_thresholds",
    "topic_counts_from_activations",
    "topic_inclusion_descriptor",
]
