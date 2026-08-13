"""Sampling and Rust-pipeline configuration for topic-modeling workers.

Encapsulates reproducible corpus sampling, top-N-words headroom arithmetic, and
the language/script heuristics that pick a c-TF-IDF vectorizer and stopword list
for the Rust pipeline, so the top-level orchestrator stays focused on
coordination.

Used by:
- ``_compute_topic_payload`` in ``topic_modeling`` delegates sampling and
  vectorizer selection to functions in this module.
- Tests that verify deterministic sampling, top-N headroom, and script
  detection import directly from here.
"""

from __future__ import annotations

import logging
import os
from typing import Any, cast

import polars as pl

from .topic_types import _SampledTopicCorpora

logger = logging.getLogger(__name__)

# c-TF-IDF vectorizer model ids understood by the Rust pipeline
# (the ``vectorizer_model`` kwarg of the ``pl.col(...).text.topic_modeling``
# expression). These mirror the ``polars_text`` tokenizer model-id constants.
_PLAIN_WORDS_EN_VECTORIZER = "native:plain_words_en"
_LINDERA_ZH_VECTORIZER = "lindera:cc-cedict"
_LINDERA_JA_VECTORIZER = "lindera:ja-ipadic"
_LINDERA_KO_VECTORIZER = "lindera:ko-dic"


def _sample_corpus(
    docs: list[str], fraction: float, seed: int
) -> tuple[list[str], list[int]]:
    """Return a reproducible random sample of docs and their original indices.

    Uses the same Polars expression as the preprocessing slice tool
    (``pl.int_range(...).sample(fraction=..., seed=...)``) so identical
    ``(seed, fraction)`` parameters select identical rows across tools.
    Operates on an in-memory integer Series; no parquet artifact is created.

    Called by:
    - ``_sample_corpora_for_topic_modeling`` (this module) for each corpus.
    - Tests that verify deterministic sampling across seeds and fractions.
    """
    if fraction >= 1.0:
        return docs, list(range(len(docs)))
    indices = (
        pl.int_range(len(docs), eager=True)
        .sample(fraction=fraction, seed=seed)
        .sort()
        .to_list()
    )
    if not indices:
        # Polars floors fraction*N, so a tiny corpus with very small fraction
        # can yield zero rows. Topic modelling needs at least one document.
        return [docs[0]], [0]
    return [docs[i] for i in indices], indices


def _sample_corpora_for_topic_modeling(
    *,
    corpora: list[list[str]],
    sample_fractions: list[float | None] | None,
    random_seed: int,
) -> _SampledTopicCorpora:
    """Sample each corpus according to ``sample_fractions`` and flatten into
    a single document list for the Rust pipeline.

    Called by:
    - ``_compute_topic_payload`` in ``topic_modeling``.

    The flattened ``all_docs`` order (corpus 0 documents, then corpus 1, ...) is
    the contract shared with ``_build_topic_result_payload``: the native result's
    ``documents[].doc_index`` indexes back into this sampled document list, and
    ``corpus_sizes`` splits the flat result back into per-corpus summaries.
    """
    corpus_sizes_before_sample = [len(corpus) for corpus in corpora]
    active_corpora: list[list[str]] = []
    active_corpora_indices: list[list[int]] = []

    if sample_fractions is not None:
        for index, corpus in enumerate(corpora):
            fraction = (
                sample_fractions[index] if index < len(sample_fractions) else None
            )
            if fraction is not None and 0.0 < fraction < 1.0:
                sampled_docs, sampled_indices = _sample_corpus(
                    corpus, fraction, random_seed + index
                )
                active_corpora.append(sampled_docs)
                active_corpora_indices.append(sampled_indices)
            else:
                active_corpora.append(corpus)
                active_corpora_indices.append(list(range(len(corpus))))
    else:
        active_corpora = list(corpora)
        active_corpora_indices = [list(range(len(corpus))) for corpus in corpora]

    all_docs = [doc for corpus in active_corpora for doc in corpus]

    return _SampledTopicCorpora(
        corpus_sizes_before_sample=corpus_sizes_before_sample,
        active_corpora=active_corpora,
        active_corpora_indices=active_corpora_indices,
        all_docs=all_docs,
        corpus_sizes=[len(corpus) for corpus in active_corpora],
    )


def _count_cjk_chars(text: str) -> tuple[int, int, int]:
    """Count (han, kana, hangul) codepoints in ``text``.

    Used by ``_resolve_vectorizer_model`` to choose a CJK-aware segmenter; the
    three buckets disambiguate Chinese (han only), Japanese (kana present), and
    Korean (hangul) so the right lindera dictionary is selected.
    """
    han = kana = hangul = 0
    for ch in text:
        code = ord(ch)
        if (
            0x4E00 <= code <= 0x9FFF  # CJK Unified Ideographs
            or 0x3400 <= code <= 0x4DBF  # CJK Extension A
            or 0xF900 <= code <= 0xFAFF  # CJK Compatibility Ideographs
        ):
            han += 1
        elif 0x3040 <= code <= 0x30FF:  # Hiragana + Katakana
            kana += 1
        elif 0xAC00 <= code <= 0xD7A3:  # Hangul syllables
            hangul += 1
    return han, kana, hangul


def _resolve_vectorizer_model(docs: list[str], *, sample_limit: int = 200) -> str:
    """Choose the Rust c-TF-IDF vectorizer from corpus script.

    The Rust pipeline tokenizes topic text itself for c-TF-IDF, so this boundary
    only needs to select the segmenter. Space-delimited languages use the
    built-in ``native:plain_words_en`` word splitter;
    CJK scripts need a lindera dictionary because there are no word boundaries.

    Heuristic: sample up to ``sample_limit`` documents and, if CJK codepoints are
    a meaningful share (>=20%) of the letters seen, pick the dominant CJK script's
    dictionary. Otherwise default to English plain words.

    Called by:
    - ``_compute_topic_payload`` in ``topic_modeling``.
    - Tests that verify EN vs CJK selection.
    """
    han = kana = hangul = letters = 0
    for doc in docs[:sample_limit]:
        if not doc:
            continue
        d_han, d_kana, d_hangul = _count_cjk_chars(doc)
        han += d_han
        kana += d_kana
        hangul += d_hangul
        letters += sum(1 for ch in doc if ch.isalpha())
        letters += d_han + d_kana + d_hangul

    cjk = han + kana + hangul
    if letters == 0 or cjk / letters < 0.20:
        return _PLAIN_WORDS_EN_VECTORIZER

    # CJK-dominant: disambiguate by script. Kana present -> Japanese; Hangul
    # dominant -> Korean; otherwise Han-only -> Chinese.
    if kana > 0:
        return _LINDERA_JA_VECTORIZER
    if hangul > han:
        return _LINDERA_KO_VECTORIZER
    return _LINDERA_ZH_VECTORIZER


def _automatic_segment_overlap(max_segment_tokens: int) -> int:
    """Return the bounded overlap used only by automatic segmentation."""

    return min(32, max_segment_tokens // 8)


def _run_rust_topic_modeling(
    *,
    all_docs: list[str],
    seed: int,
    min_cluster_size: int,
    vectorizer_model: str | None,
    segmentation_method: str = "automatic",
    max_segment_tokens: int = 256,
    embedder_model: str | None = None,
    embedding_cache: str | os.PathLike[str] | None = None,
) -> dict:
    """Run the Rust topic-modeling pipeline via the Polars expression and
    reconstruct the result dict the payload builder consumes.

    Topic modeling is exposed by ``polars-text`` as a first-class Polars
    expression in the ``.text`` namespace (``pl.col(...).text.topic_modeling``),
    mirroring ``tokenize``/``concordance``. The Rust side owns chunking, ORT
    segmentation, ORT embedding, PaCMAP reduction, HDBSCAN clustering, and
    c-TF-IDF labeling. The
    number of topics is whatever HDBSCAN yields for ``min_cluster_size`` (the
    only native topic-count control). The expression returns one struct **per
    input document** with the document's ``dominant_topic`` and
    ``topic_distribution`` plus the per-topic metadata
    (``representative_words``/``x``/``y``) replicated onto each row under its
    dominant topic, and the run-level ``n_topics`` / ``n_chunks`` /
    ``stage_timings_ms`` replicated on every row.

    Flow:
    1. Wrap ``all_docs`` in a one-column frame and evaluate the expression,
       unnesting the per-row struct into flat columns.
    2. Rebuild ``documents`` as ``[{doc_index, dominant_topic}]`` in input order.
    3. Rebuild ``topics`` by grouping the rows whose ``dominant_topic >= 0`` and
       taking the (replicated) ``representative_words``/``x``/``y`` once per
       topic. ``n_topics`` is the number of topics with at least one dominant
       document, so the displayed count matches the bubble chart; ``n_chunks`` is
    read from the first row. ``stage_timings_ms`` is also read from the first
    row because it describes the whole native run.

    Called by:
    - ``_compute_topic_payload`` in ``topic_modeling`` for the initial run.
    """
    import polars_text  # noqa: F401  (registers the ``.text`` expr namespace)

    result = (
        pl.DataFrame({"__doc__": all_docs})
        .select(
            cast(Any, pl.col("__doc__"))
            .text.topic_modeling(
                embedder_model=embedder_model,
                cache=embedding_cache,
                segmentation_method=segmentation_method,
                max_tokens=max_segment_tokens,
                overlap=_automatic_segment_overlap(max_segment_tokens),
                seed=int(seed),
                min_cluster_size=int(min_cluster_size),
                vectorizer_model=vectorizer_model,
                lowercase=True,
            )
            .alias("__topic__")
        )
        .unnest("__topic__")
    )

    # ``topic_distribution`` is the per-document soft assignment: a fixed set of
    # ``{topic_id, proportion}`` (proportions sum to ~1 across the doc's
    # chunks). It powers the Topic Distribution filter ("keep docs where
    # topic N proportion >= x"), so it is carried through to the assignment
    # parquet rather than dropped. Each document's distribution is padded to
    # include *every* non-negative topic id (0.0 when the doc has no chunk in
    # that topic) so the persisted column has a complete, uniform key set the
    # frontend can render and offer as filter options.
    dominant_list = result["dominant_topic"].to_list()
    distribution_list = result["topic_distribution"].to_list()

    topics_frame = (
        result.filter(pl.col("dominant_topic") >= 0)
        .group_by("dominant_topic")
        .agg(
            pl.col("representative_words").first(),
            pl.col("x").first(),
            pl.col("y").first(),
        )
        .sort("dominant_topic")
    )
    topics = [
        {
            "id": int(row["dominant_topic"]),
            "representative_words": [
                word for word in (row["representative_words"] or []) if word
            ],
            "x": float(row["x"]),
            "y": float(row["y"]),
        }
        for row in topics_frame.iter_rows(named=True)
    ]

    all_topic_ids: list[int] = sorted(cast(int, topic["id"]) for topic in topics)
    documents = []
    for index, topic in enumerate(dominant_list):
        present: dict[int, float] = {}
        for entry in distribution_list[index] or []:
            try:
                topic_id = int(entry["topic_id"])
                proportion = float(entry["proportion"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError("Topic Distribution entry is malformed") from exc
            if topic_id in present:
                raise ValueError("Topic Distribution contains a duplicate topic id")
            present[topic_id] = proportion
        unknown = set(present).difference({-1, *all_topic_ids})
        if unknown:
            raise ValueError("Topic Distribution contains an unknown topic id")
        padded: dict[int, float] = {-1: present.get(-1, 0.0)}
        for topic_id in all_topic_ids:
            padded[topic_id] = present.get(topic_id, 0.0)
        documents.append(
            {
                "doc_index": index,
                "dominant_topic": int(topic),
                "topic_distribution": [
                    {"topic_id": topic_id, "proportion": padded[topic_id]}
                    for topic_id in sorted(padded)
                ],
            }
        )

    n_chunks = int(result["n_chunks"][0]) if result.height else 0
    truncated_segment_count = (
        int(result["truncated_segment_count"][0])
        if result.height and "truncated_segment_count" in result.columns
        else 0
    )
    raw_stage_timings = (
        result["stage_timings_ms"].to_list()[0]
        if result.height and "stage_timings_ms" in result.columns
        else []
    )
    stage_timings_ms = []
    for timing in raw_stage_timings or []:
        if not isinstance(timing, dict):
            continue
        stage = timing.get("stage")
        elapsed_ms = timing.get("elapsed_ms")
        if stage is None or elapsed_ms is None:
            continue
        stage_timings_ms.append({"stage": str(stage), "elapsed_ms": float(elapsed_ms)})

    return {
        "topics": topics,
        "documents": documents,
        "n_topics": len(topics),
        "n_chunks": n_chunks,
        "truncated_segment_count": truncated_segment_count,
        "stage_timings_ms": stage_timings_ms,
    }
