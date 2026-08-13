"""Tests for preparing the stable per-class examples used by Annotation AI."""

from __future__ import annotations

import pytest

from ldaca_wordflow.analysis.annotation_examples import prepare_annotation_examples
from ldaca_wordflow.domain.annotation import AnnotationExampleSamplingMethod


def _pairs() -> list[tuple[object, object]]:
    return [
        (" a1 ", " A "),
        ("a2", "A"),
        ("a3", "A"),
        ("b1", "B"),
        ("b2", "B"),
        ("c1", "Outside codebook"),
        ("", "A"),
        ("ignored", "  "),
        (None, "B"),
    ]


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("first_n", [("a1", "A"), ("a2", "A"), ("b1", "B"), ("b2", "B"), ("c1", "Outside codebook")]),
        ("last_n", [("a2", "A"), ("a3", "A"), ("b1", "B"), ("b2", "B"), ("c1", "Outside codebook")]),
    ],
)
def test_prepare_annotation_examples_filters_groups_and_selects_in_order(
    method: AnnotationExampleSamplingMethod,
    expected: list[tuple[str, str]],
) -> None:
    examples = prepare_annotation_examples(
        _pairs(),
        max_examples_per_class=2,
        sampling_method=method,
        random_seed=0,
    )

    assert [(example.text, example.label) for example in examples] == expected


def test_prepare_annotation_examples_random_is_seeded_without_replacement() -> None:
    rows = [
        ("a1", "A"),
        ("a2", "A"),
        ("a3", "A"),
        ("a4", "A"),
        ("b1", "B"),
        ("b2", "B"),
        ("b3", "B"),
    ]

    first = prepare_annotation_examples(
        rows,
        max_examples_per_class=2,
        sampling_method="random",
        random_seed=0,
    )
    repeated = prepare_annotation_examples(
        rows,
        max_examples_per_class=2,
        sampling_method="random",
        random_seed=0,
    )

    assert first == repeated
    assert [(example.text, example.label) for example in first] == [
        ("a4", "A"),
        ("a2", "A"),
        ("b1", "B"),
        ("b2", "B"),
    ]
    assert len({example.text for example in first}) == len(first)


def test_prepare_annotation_examples_returns_empty_when_no_pairs_are_usable() -> None:
    assert (
        prepare_annotation_examples(
            [(None, "A"), ("text", None), (" ", "A")],
            max_examples_per_class=10,
            sampling_method="random",
            random_seed=0,
        )
        == []
    )
