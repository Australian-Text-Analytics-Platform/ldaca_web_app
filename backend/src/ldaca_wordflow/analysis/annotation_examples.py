"""Prepare immutable Example Data Block rows for Annotation inference.

Used by Preview result queries and the Run All worker so both paths apply the
same blank filtering, per-class grouping, and deterministic selection rules.
"""

from __future__ import annotations

import random
from collections.abc import Iterable
from dataclasses import dataclass

from ..domain.annotation import AnnotationExampleSamplingMethod


@dataclass(frozen=True)
class AnnotationExample:
    """One normalized text-label pair included in an Annotation prompt."""

    text: str
    label: str


def prepare_annotation_examples(
    rows: Iterable[tuple[object, object]],
    *,
    max_examples_per_class: int,
    sampling_method: AnnotationExampleSamplingMethod,
    random_seed: int,
) -> list[AnnotationExample]:
    """Select one stable subset from raw Example Data Block pairs.

    Called by Preview for each deterministic snapshot query and by Run All once
    before provider batching. Blank pairs are discarded, exact labels form
    first-seen groups, and the chosen rows are concatenated in group order.
    """

    groups: dict[str, list[AnnotationExample]] = {}
    for text, label in rows:
        normalized_text = str(text).strip() if text is not None else ""
        normalized_label = str(label).strip() if label is not None else ""
        if not normalized_text or not normalized_label:
            continue
        groups.setdefault(normalized_label, []).append(
            AnnotationExample(text=normalized_text, label=normalized_label)
        )

    selected: list[AnnotationExample] = []
    rng = random.Random(random_seed)
    for examples in groups.values():
        sample_size = min(max_examples_per_class, len(examples))
        if sampling_method == "first_n":
            selected.extend(examples[:sample_size])
        elif sampling_method == "last_n":
            selected.extend(examples[-sample_size:])
        else:
            selected.extend(rng.sample(examples, sample_size))
    return selected


__all__ = ["AnnotationExample", "prepare_annotation_examples"]
