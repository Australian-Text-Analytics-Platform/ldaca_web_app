"""Private immutable types for the topic-modeling worker pipeline.

Used by:
- Other topic-modeling worker modules.

All types are frozen dataclasses so partial data snapshots are safe to
thread between pipeline stages.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class _PreparedTopicPayload:
    """Loaded, validated corpora ready for the Rust topic-modeling pipeline.

    Called by:
    - ``_prepare_payload`` in ``topic_modeling`` builds and returns one.
    - ``run_topic_modeling_analysis`` destructures it before calling
      ``_compute_topic_payload``.

    The Rust pipeline (``polars_text._internal.run_topic_modeling``) embeds and
    tokenizes raw text itself, so this carries only raw documents per node plus
    source order.
    """

    artifact_root: Path
    corpora: list[list[str]]


@dataclass(frozen=True)
class _SampledTopicCorpora:
    """Sampled-and-flattened corpora handed to the Rust pipeline.

    Called by:
    - ``_sample_corpora_for_topic_modeling`` builds and returns one.
    - ``_compute_topic_payload`` and ``_build_empty_topic_payload`` consume it.

    ``active_corpora_indices`` maps each sampled document back to its original
    node row so the per-node ``__row_nr__`` assignment parquet lines up with the
    source frame during Data Block Creation. ``all_docs`` is the flattened (corpus 0 then
    corpus 1 ...) document list whose order matches the Rust
    ``documents[].doc_index``.
    """

    corpus_sizes_before_sample: list[int]
    active_corpora: list[list[str]]
    active_corpora_indices: list[list[int]]
    all_docs: list[str]
    corpus_sizes: list[int]
