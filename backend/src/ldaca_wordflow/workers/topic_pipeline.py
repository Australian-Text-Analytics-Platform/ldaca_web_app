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

import json
import logging
import os
from typing import Any, cast

import polars as pl

from ..analysis.topic_projection import normalize_projected_topics
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
    shared by Topic Result and Data Block projection: the native result's
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
    """Run the scalar Rust topic-modeling expression and validate its payload.

    Rust owns the shared segment → embed → cluster → c-TF-IDF → length-weighted
    rollup pipeline. Its scalar result contains complete ``documents`` and
    ``topics`` lists, so topic metadata does not depend on whether a topic is
    dominant for any document. This boundary pads distributions for persisted
    Topic Distribution values and rejects malformed native output.

    Called by:
    - ``_compute_topic_payload`` in ``topic_modeling`` for the initial run.
    """
    import polars_text  # noqa: F401  (registers the ``.text`` expr namespace)

    result_frame = pl.DataFrame({"__doc__": all_docs}).select(
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
    if result_frame.height != 1:
        raise ValueError("Topic modeling native result must contain exactly one run")
    raw_result = result_frame["__topic__"][0]
    if not isinstance(raw_result, dict):
        raise ValueError("Topic modeling native result is malformed")
    clustering_context = raw_result.get("clustering_context")
    if not isinstance(clustering_context, bytes):
        raise ValueError("Topic modeling native clustering context is malformed")

    raw_topics = raw_result.get("topics")
    if not isinstance(raw_topics, list):
        raise ValueError("Topic modeling native topics are malformed")
    topics = []
    for raw_topic in raw_topics:
        if not isinstance(raw_topic, dict):
            raise ValueError("Topic modeling native topic is malformed")
        try:
            topic_id = int(raw_topic["id"])
            representative_words = [
                word for word in (raw_topic["representative_words"] or []) if word
            ]
            x = float(raw_topic["x"])
            y = float(raw_topic["y"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Topic modeling native topic is malformed") from exc
        topics.append(
            {
                "id": topic_id,
                "representative_words": representative_words,
                "x": x,
                "y": y,
            }
        )
    all_topic_ids = [cast(int, topic["id"]) for topic in topics]
    if all_topic_ids != list(range(len(topics))):
        raise ValueError("Topic modeling native topic ids must be contiguous")

    raw_documents = raw_result.get("documents")
    if not isinstance(raw_documents, list) or len(raw_documents) != len(all_docs):
        raise ValueError("Topic modeling native documents are malformed")
    documents = []
    for index, raw_document in enumerate(raw_documents):
        if not isinstance(raw_document, dict):
            raise ValueError("Topic modeling native document is malformed")
        document_data = cast(dict[str, object], raw_document)
        try:
            doc_index = int(cast(Any, document_data["doc_index"]))
            dominant_topic = int(cast(Any, document_data["dominant_topic"]))
            raw_distribution = document_data["topic_distribution"] or []
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("Topic modeling native document is malformed") from exc
        if doc_index != index:
            raise ValueError("Topic modeling native document indices are invalid")
        if dominant_topic not in {-1, *all_topic_ids}:
            raise ValueError("Topic modeling native dominant topic is unknown")
        if not isinstance(raw_distribution, list):
            raise ValueError("Topic Distribution is malformed")
        present: dict[int, float] = {}
        for entry in raw_distribution:
            if not isinstance(entry, dict):
                raise ValueError("Topic Distribution entry is malformed")
            distribution_entry = cast(dict[str, object], entry)
            try:
                topic_id = int(cast(Any, distribution_entry["topic_id"]))
                proportion = float(cast(Any, distribution_entry["proportion"]))
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
                "dominant_topic": dominant_topic,
                "topic_distribution": [
                    {"topic_id": topic_id, "proportion": padded[topic_id]}
                    for topic_id in sorted(padded)
                ],
            }
        )

    try:
        n_chunks = int(raw_result["n_chunks"])
        truncated_segment_count = int(raw_result["truncated_segment_count"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Topic modeling native run metadata is malformed") from exc
    raw_stage_timings = raw_result.get("stage_timings_ms") or []
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
        "clustering_context": clustering_context,
    }

def _project_rust_topic_modeling(
    *, clustering_context: bytes, cluster_count: int, document_count: int
) -> dict[str, Any]:
    """Project complete row distributions for Data Block Creation."""

    from polars_text import _internal

    try:
        raw_result = json.loads(
            _internal.project_topic_modeling_context(
                clustering_context, int(cluster_count)
            )
        )
    except (TypeError, ValueError, RuntimeError) as exc:
        raise ValueError("Topic clustering context is invalid") from exc
    if not isinstance(raw_result, dict):
        raise ValueError("Topic projection result is malformed")
    raw_documents = raw_result.get("documents")
    if not isinstance(raw_documents, list):
        raise ValueError("Topic projection result is malformed")
    if len(raw_documents) != document_count:
        raise ValueError("Topic projection result has invalid dimensions")
    topics = normalize_projected_topics(raw_result.get("topics"), cluster_count)
    documents: list[dict[str, Any]] = []
    expected_topic_ids = {-1, *range(cluster_count)}
    for expected_index, raw_document in enumerate(raw_documents):
        if not isinstance(raw_document, dict):
            raise ValueError("Topic projection document indices are invalid")
        document = cast(dict[str, Any], raw_document)
        if int(document.get("doc_index", -1)) != expected_index:
            raise ValueError("Topic projection document indices are invalid")
        distribution: dict[int, float] = {}
        for raw_entry in document.get("topic_distribution") or []:
            try:
                topic_id, proportion = raw_entry
                normalized_topic_id = int(topic_id)
                normalized_proportion = float(proportion)
            except (TypeError, ValueError) as exc:
                raise ValueError("Topic projection distribution is malformed") from exc
            if normalized_topic_id not in expected_topic_ids:
                raise ValueError("Topic projection distribution contains an unknown Topic")
            if normalized_topic_id in distribution:
                raise ValueError("Topic projection distribution contains a duplicate Topic")
            distribution[normalized_topic_id] = normalized_proportion
        documents.append(
            {
                "doc_index": expected_index,
                "dominant_topic": int(document.get("dominant_topic", -1)),
                "topic_distribution": [
                    {
                        "topic_id": topic_id,
                        "proportion": distribution[topic_id],
                    }
                    for topic_id in sorted(distribution)
                ],
            }
        )
    return {
        "topics": topics,
        "documents": documents,
        "n_topics": cluster_count,
        "n_chunks": int(raw_result.get("n_chunks") or 0),
        "truncated_segment_count": int(
            raw_result.get("truncated_segment_count") or 0
        ),
        "stage_timings_ms": [],
    }
