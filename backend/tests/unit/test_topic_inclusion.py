"""Top-N Topic membership semantics over complete sparse coverage."""

import pytest

from ldaca_wordflow.analysis.topic_inclusion import (
    aggregate_topic_activations,
    top_topic_ids,
    topic_counts_from_activations,
    topic_inclusion_descriptor,
)


def _coverage(*values: float) -> list[dict[str, float | int]]:
    return [
        {"topic_id": topic_id, "coverage": coverage}
        for topic_id, coverage in enumerate(values)
    ]


def test_descriptor_handles_empty_single_and_adjustable_results() -> None:
    assert topic_inclusion_descriptor(0) == {
        "top_n_topics": 0,
        "min_top_n_topics": 0,
        "max_top_n_topics": 0,
        "default_top_n_topics": 0,
        "adjustable": False,
    }
    assert topic_inclusion_descriptor(1)["top_n_topics"] == 1
    assert topic_inclusion_descriptor(4)["top_n_topics"] == 2
    with pytest.raises(ValueError, match="outside"):
        topic_inclusion_descriptor(2, 0)


def test_membership_excludes_zero_and_outlier_and_includes_cutoff_ties() -> None:
    coverage = [
        {"topic_id": -1, "coverage": 0.8},
        *_coverage(0.5, 0.25, 0.25, 0.0),
    ]

    assert top_topic_ids(coverage, 4, 1) == {0}
    assert top_topic_ids(coverage, 4, 2) == {0, 1, 2}
    assert top_topic_ids(coverage, 4, 4) == {0, 1, 2}


def test_aggregated_counts_are_per_corpus_and_can_exceed_row_count() -> None:
    documents = [
        {"doc_index": 0, "topic_coverage": _coverage(0.6, 0.4, 0.0)},
        {"doc_index": 1, "topic_coverage": _coverage(0.5, 0.5, 0.0)},
        {"doc_index": 2, "topic_coverage": _coverage(0.0, 0.2, 0.8)},
        {"doc_index": 3, "topic_coverage": []},
    ]
    activations = aggregate_topic_activations(documents, [2, 2], 3)

    assert topic_counts_from_activations(
        activations,
        corpus_count=2,
        topic_count=3,
        top_n_topics=1,
    ) == [{0: 2, 1: 1}, {2: 1}]
    top_two = topic_counts_from_activations(
        activations,
        corpus_count=2,
        topic_count=3,
        top_n_topics=2,
    )
    assert top_two == [{0: 2, 1: 2}, {1: 1, 2: 1}]
    assert sum(top_two[0].values()) > 2
