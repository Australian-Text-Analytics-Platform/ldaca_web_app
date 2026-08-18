"""Deterministic unit tests for the Rust-backed topic-modeling worker.

The heavy lifting (chunking, ORT embeddings, PaCMAP, HDBSCAN, c-TF-IDF) lives
in the ``polars-text`` Rust extension and is exercised by the hand-run
experiment harness, not here -- its output is non-deterministic. These tests
cover only the deterministic Python glue:

- corpus sampling and the c-TF-IDF vectorizer/stopword heuristics
  (``workers.topic_pipeline``),
- the reconstruction of the result dict from the ``.text.topic_modeling``
  expression (``_run_rust_topic_modeling``), with the expression itself faked,
- the payload/parquet assembly and meta in the orchestrator
  (``_compute_topic_modeling``) and the exact-count re-aggregation path, with
  ``_run_rust_topic_modeling`` faked to a canned result.
"""

from __future__ import annotations

from typing import Any

import polars as pl
import pytest
from ldaca_wordflow.workers import topic_modeling, topic_pipeline, topic_result
from ldaca_wordflow.workers.topic_pipeline import (
    _automatic_segment_overlap,
    _sample_corpus,
)

_STAGE_TIMINGS = [
    {"stage": "embedding", "elapsed_ms": 12.5},
    {"stage": "total", "elapsed_ms": 15.0},
]


def _terms(*words: str) -> list[dict[str, Any]]:
    return [{"word": word, "occurrence_count": 1} for word in words]


@pytest.mark.parametrize(
    "entries",
    [
        [{"topic_id": 0, "proportion": 0.5}, {"topic_id": 0, "proportion": 0.5}],
        [{"topic_id": 9, "proportion": 1.0}],
        [{"topic_id": "bad", "proportion": 1.0}],
    ],
)
def test_topic_distribution_rejects_noncanonical_entries(entries) -> None:
    with pytest.raises(ValueError, match="Topic Distribution"):
        topic_result._distribution_by_doc_index(
            [{"doc_index": 0, "topic_distribution": entries}],
            1,
            [0],
        )


# ---------------------------------------------------------------------------
# Sampling helpers (pure, deterministic)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("max_segment_tokens", "expected_overlap"),
    [(32, 4), (64, 8), (128, 16), (256, 32), (510, 32)],
)
def test_automatic_segment_overlap_is_scaled_and_bounded(
    max_segment_tokens: int, expected_overlap: int
) -> None:
    assert _automatic_segment_overlap(max_segment_tokens) == expected_overlap


def test_sample_corpus_reduces_length_and_is_reproducible():
    docs = [f"doc {i}" for i in range(100)]
    sampled_docs, sampled_idx = _sample_corpus(docs, 0.5, seed=0)
    assert len(sampled_docs) == 50
    assert len(sampled_idx) == 50
    # Same seed reproduces the exact sample.
    docs2, idx2 = _sample_corpus(docs, 0.5, seed=0)
    assert docs2 == sampled_docs
    assert idx2 == sampled_idx
    # A different seed selects a different sample.
    docs3, _ = _sample_corpus(docs, 0.5, seed=99)
    assert docs3 != sampled_docs


def test_sample_corpus_indices_are_original_sorted_positions():
    docs = [f"doc {i}" for i in range(20)]
    sampled_docs, sampled_idx = _sample_corpus(docs, 0.5, seed=7)
    for doc, idx in zip(sampled_docs, sampled_idx):
        assert doc == docs[idx]
    assert sampled_idx == sorted(sampled_idx)


def test_sample_corpus_fraction_at_or_above_one_returns_original():
    docs = ["a", "b", "c"]
    result_docs, result_idx = _sample_corpus(docs, 1.0, seed=0)
    assert result_docs is docs
    assert result_idx == [0, 1, 2]
    result_docs2, _ = _sample_corpus(docs, 2.0, seed=0)
    assert result_docs2 is docs


def test_sample_corpus_min_k_is_one():
    docs = ["only"]
    result_docs, result_idx = _sample_corpus(docs, 0.01, seed=0)
    assert len(result_docs) == 1
    assert len(result_idx) == 1


# ---------------------------------------------------------------------------
# _run_rust_topic_modeling: reconstruct the result dict from the expression
# ---------------------------------------------------------------------------


def _fake_topic_modeling_expr_factory(
    *,
    documents: list[dict[str, Any]],
    topics: list[dict[str, Any]],
    n_chunks: int,
    truncated_segment_count: int = 0,
    distribution: list[list[dict[str, Any]]] | None = None,
    stage_timings: list[dict[str, Any]] | None = None,
    seen_kwargs: dict[str, Any] | None = None,
):
    """Build a fake ``.text.topic_modeling`` method returning a canned struct.

    The real expression returns one scalar run result with independent document
    outcomes and complete topic metadata. The fake mirrors that nested shape so
    backend validation can be tested without running the Rust pipeline.
    """

    documents = [
        {
            **document,
            "topic_distribution": (
                distribution[index]
                if distribution is not None
                else document.get(
                    "topic_distribution",
                    [
                        {
                            "topic_id": int(document["dominant_topic"]),
                            "proportion": 1.0,
                        }
                    ]
                    if int(document["dominant_topic"]) >= 0
                    else [],
                )
            ),
        }
        for index, document in enumerate(documents)
    ]
    timings = stage_timings if stage_timings is not None else _STAGE_TIMINGS

    def _fake(self, **kwargs):  # noqa: ANN001 - mirrors namespace method shape
        if seen_kwargs is not None:
            seen_kwargs.update(kwargs)
        return pl.struct(
            pl.Series(
                "documents",
                [documents],
                dtype=pl.List(
                    pl.Struct(
                        {
                            "doc_index": pl.UInt32,
                            "dominant_topic": pl.Int32,
                            "topic_distribution": pl.List(
                                pl.Struct(
                                    {"topic_id": pl.Int32, "proportion": pl.Float32}
                                )
                            ),
                        }
                    )
                ),
            ),
            pl.Series(
                "topics",
                [topics],
                dtype=pl.List(
                    pl.Struct(
                        {
                            "id": pl.Int32,
                            "representative_words": pl.List(
                                pl.Struct(
                                    {"word": pl.String, "occurrence_count": pl.UInt64}
                                )
                            ),
                            "x": pl.Float32,
                            "y": pl.Float32,
                        }
                    )
                ),
            ),
            pl.lit(n_chunks, dtype=pl.UInt32).alias("n_chunks"),
            pl.lit(truncated_segment_count, dtype=pl.UInt32).alias(
                "truncated_segment_count"
            ),
            pl.lit(b"context", dtype=pl.Binary).alias("clustering_context"),
            pl.Series(
                "stage_timings_ms",
                [timings],
                dtype=pl.List(
                    pl.Struct({"stage": pl.String, "elapsed_ms": pl.Float64})
                ),
            ),
        )

    return _fake


def test_run_rust_topic_modeling_reconstructs_result_dict(monkeypatch):
    from polars_text.namespace import TextNamespace

    monkeypatch.setattr(
        TextNamespace,
        "topic_modeling",
        _fake_topic_modeling_expr_factory(
            documents=[
                {"doc_index": 0, "dominant_topic": 0},
                {"doc_index": 1, "dominant_topic": 0},
                {"doc_index": 2, "dominant_topic": 0},
                {"doc_index": 3, "dominant_topic": -1},
            ],
            topics=[
                {
                    "id": 0,
                    "representative_words": _terms("alpha", "beta"),
                    "x": 1.0,
                    "y": 3.0,
                },
                {
                    "id": 1,
                    "representative_words": _terms("gamma"),
                    "x": 2.0,
                    "y": 4.0,
                },
            ],
            n_chunks=5,
            distribution=[
                [
                    {"topic_id": 0, "proportion": 0.9},
                    {"topic_id": 1, "proportion": 0.1},
                ],
                [{"topic_id": 0, "proportion": 1.0}],
                [
                    {"topic_id": 0, "proportion": 0.2},
                    {"topic_id": 1, "proportion": 0.8},
                ],
                [],
            ],
        ),
    )

    result = topic_pipeline._run_rust_topic_modeling(
        all_docs=["d0", "d1", "d2", "d3"],
        seed=0,
        min_cluster_size=10,
        vectorizer_model="native:plain_words_en",
        embedder_model="fake-model",
    )

    # Documents carry both the dominant topic and the soft Topic Distribution.
    # The distribution always starts with outlier -1 and then every real topic id.
    # appears in every document, with 0.0 where the doc has no presence; this
    # powers the Topic Distribution filter and the data-view bars. The outlier
    # document (-1) has no non-negative dominant topics of its own but still
    # gets the full padded key set.
    assert result["documents"] == [
        {
            "doc_index": 0,
            "dominant_topic": 0,
            "topic_distribution": [
                {"topic_id": -1, "proportion": pytest.approx(0.0)},
                {"topic_id": 0, "proportion": pytest.approx(0.9)},
                {"topic_id": 1, "proportion": pytest.approx(0.1)},
            ],
        },
        {
            "doc_index": 1,
            "dominant_topic": 0,
            "topic_distribution": [
                {"topic_id": -1, "proportion": pytest.approx(0.0)},
                {"topic_id": 0, "proportion": pytest.approx(1.0)},
                {"topic_id": 1, "proportion": pytest.approx(0.0)},
            ],
        },
        {
            "doc_index": 2,
            "dominant_topic": 0,
            "topic_distribution": [
                {"topic_id": -1, "proportion": pytest.approx(0.0)},
                {"topic_id": 0, "proportion": pytest.approx(0.2)},
                {"topic_id": 1, "proportion": pytest.approx(0.8)},
            ],
        },
        {
            "doc_index": 3,
            "dominant_topic": -1,
            "topic_distribution": [
                {"topic_id": -1, "proportion": pytest.approx(0.0)},
                {"topic_id": 0, "proportion": pytest.approx(0.0)},
                {"topic_id": 1, "proportion": pytest.approx(0.0)},
            ],
        },
    ]
    # Topic 1 is preserved even though it never dominates a document.
    assert result["topics"] == [
        {"id": 0, "representative_words": _terms("alpha", "beta"), "x": 1.0, "y": 3.0},
        {"id": 1, "representative_words": _terms("gamma"), "x": 2.0, "y": 4.0},
    ]
    assert result["n_topics"] == 2
    assert result["n_chunks"] == 5
    assert result["stage_timings_ms"] == _STAGE_TIMINGS


@pytest.mark.parametrize("segmentation_method", ["automatic", "paragraph", "sentence"])
def test_run_rust_topic_modeling_forwards_each_segmentation_mode_to_shared_pipeline(
    monkeypatch, segmentation_method: str
) -> None:
    from polars_text.namespace import TextNamespace

    seen_kwargs: dict[str, Any] = {}
    monkeypatch.setattr(
        TextNamespace,
        "topic_modeling",
        _fake_topic_modeling_expr_factory(
            documents=[{"doc_index": 0, "dominant_topic": 0}],
            topics=[
                {
                    "id": 0,
                    "representative_words": _terms("alpha"),
                    "x": 0.0,
                    "y": 0.0,
                }
            ],
            n_chunks=3,
            truncated_segment_count=2,
            seen_kwargs=seen_kwargs,
        ),
    )

    result = topic_pipeline._run_rust_topic_modeling(
        all_docs=["one document"],
        seed=0,
        min_cluster_size=2,
        vectorizer_model="native:plain_words_en",
        segmentation_method=segmentation_method,
        max_segment_tokens=64,
    )

    assert (
        seen_kwargs["segmentation_method"],
        seen_kwargs["max_tokens"],
        seen_kwargs["overlap"],
        result["truncated_segment_count"],
    ) == (segmentation_method, 64, 8, 2)


@pytest.mark.parametrize(
    ("documents", "topics", "message"),
    [
        (
            [
                {
                    "doc_index": 0,
                    "dominant_topic": 1,
                    "topic_distribution": [{"topic_id": 1, "proportion": 1.0}],
                }
            ],
            [
                {
                    "id": 1,
                    "representative_words": [],
                    "x": 0.0,
                    "y": 0.0,
                }
            ],
            "topic ids must be contiguous",
        ),
        (
            [
                {
                    "doc_index": 3,
                    "dominant_topic": 0,
                    "topic_distribution": [{"topic_id": 0, "proportion": 1.0}],
                }
            ],
            [
                {
                    "id": 0,
                    "representative_words": [],
                    "x": 0.0,
                    "y": 0.0,
                }
            ],
            "document indices are invalid",
        ),
        (
            [
                {
                    "doc_index": 0,
                    "dominant_topic": 0,
                    "topic_distribution": [
                        {"topic_id": 0, "proportion": 0.5},
                        {"topic_id": 0, "proportion": 0.5},
                    ],
                }
            ],
            [
                {
                    "id": 0,
                    "representative_words": [],
                    "x": 0.0,
                    "y": 0.0,
                }
            ],
            "duplicate topic id",
        ),
    ],
)
def test_run_rust_topic_modeling_rejects_invalid_native_identity_contracts(
    monkeypatch,
    documents: list[dict[str, Any]],
    topics: list[dict[str, Any]],
    message: str,
) -> None:
    from polars_text.namespace import TextNamespace

    monkeypatch.setattr(
        TextNamespace,
        "topic_modeling",
        _fake_topic_modeling_expr_factory(
            documents=documents,
            topics=topics,
            n_chunks=1,
        ),
    )

    with pytest.raises(ValueError, match=message):
        topic_pipeline._run_rust_topic_modeling(
            all_docs=["one document"],
            seed=0,
            min_cluster_size=2,
            vectorizer_model="native:plain_words_en",
        )


# ---------------------------------------------------------------------------
# Orchestrator + payload assembly (with _run_rust_topic_modeling faked)
# ---------------------------------------------------------------------------


def _canned_rust_result(
    *,
    documents: list[dict[str, Any]],
    topics: list[dict[str, Any]],
    n_chunks: int = 7,
    truncated_segment_count: int = 0,
    stage_timings_ms: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "documents": documents,
        "topics": topics,
        "n_topics": len(topics),
        "n_chunks": n_chunks,
        "truncated_segment_count": truncated_segment_count,
        "stage_timings_ms": stage_timings_ms or _STAGE_TIMINGS,
        "clustering_context": b"context",
    }


def _node_info(node_id: str = "node-1") -> dict[str, Any]:
    return {
        "node_id": node_id,
        "node_name": f"Node {node_id}",
        "text_column": "document",
        "original_columns": ["document"],
    }


def test__compute_topic_modeling_writes_only_clustering_context(
    tmp_path, monkeypatch
):
    progress: list[tuple[float, str]] = []

    seen_run_kwargs: dict[str, Any] = {}

    def fake_run(**kwargs):
        seen_run_kwargs.update(kwargs)
        return _canned_rust_result(
            documents=[
                {
                    "doc_index": 0,
                    "dominant_topic": 0,
                    "topic_distribution": [{"topic_id": 0, "proportion": 1.0}],
                },
                {
                    "doc_index": 1,
                    "dominant_topic": 0,
                    "topic_distribution": [
                        {"topic_id": 0, "proportion": 0.7},
                        {"topic_id": 1, "proportion": 0.3},
                    ],
                },
            ],
            topics=[
                {
                    "id": 0,
                    "representative_words": _terms("alpha", "beta", "gamma"),
                    "x": 1.5,
                    "y": -2.0,
                },
                {
                    "id": 1,
                    "representative_words": _terms("delta"),
                    "x": 2.5,
                    "y": 3.0,
                },
            ],
            truncated_segment_count=2,
        )

    monkeypatch.setattr(topic_modeling, "_run_rust_topic_modeling", fake_run)
    embedding_cache_path = tmp_path / "embeddings.duckdb"

    result = topic_modeling._compute_topic_modeling(
        workspace_id="w",
        corpora=[["doc one", "doc two"]],
        node_infos=[_node_info()],
        artifact_dir=str(tmp_path),
        artifact_prefix="tm_test",
        segmentation_method="paragraph",
        max_segment_tokens=64,
        embedding_cache_path=str(embedding_cache_path),
        progress_callback=lambda p, m: progress.append((p, m)),
    )

    context_path = tmp_path / "tm_test_topic_clustering_context.msgpack.zst"
    assert context_path.read_bytes() == b"context"
    assert not list(tmp_path.glob("*assignments*.parquet"))
    assert not list(tmp_path.glob("*meanings*.parquet"))

    topic = result["topics"][0]
    assert topic["representative_words"] == _terms("alpha", "beta", "gamma")
    assert "label" not in topic
    assert topic["x"] == pytest.approx(1.5)
    assert topic["y"] == pytest.approx(-2.0)
    assert topic["size"] == [2]

    assert result["meta"]["engine"] == "rust"
    assert result["meta"]["embedding_backend"] == "ort"
    assert seen_run_kwargs["embedding_cache"] == str(embedding_cache_path)
    assert seen_run_kwargs["segmentation_method"] == "paragraph"
    assert seen_run_kwargs["max_segment_tokens"] == 64
    assert result["meta"]["n_chunks"] == 7
    assert result["meta"]["truncated_segment_count"] == 2
    assert result["meta"]["stage_timings_ms"] == _STAGE_TIMINGS
    assert progress[0][1].startswith("Loading topic modelling")
    assert progress[-1] == (0.9, "Writing topic-modelling results...")
    assert all(0.0 <= fraction < 1.0 for fraction, _message in progress)


def test__compute_topic_modeling_payload_keeps_all_ranked_candidates(
    tmp_path, monkeypatch
):
    """The payload and meaning artifact keep all ranked candidates."""

    many_words = [f"w{i}" for i in range(60)]

    def fake_run(**_kwargs):
        return _canned_rust_result(
            documents=[{"doc_index": 0, "dominant_topic": 0}],
            topics=[
                {
                    "id": 0,
                    "representative_words": _terms(*many_words),
                    "x": 0.0,
                    "y": 0.0,
                }
            ],
        )

    monkeypatch.setattr(topic_modeling, "_run_rust_topic_modeling", fake_run)

    result = topic_modeling._compute_topic_modeling(
        workspace_id="w",
        corpora=[["only doc"]],
        node_infos=[_node_info()],
        artifact_dir=str(tmp_path),
        artifact_prefix="tm_cap",
        embedding_cache_path=str(tmp_path / "embeddings.duckdb"),
    )

    assert result["topics"][0]["representative_words"] == _terms(*many_words)
    assert result["clustering"]["cluster_count"] == 1


def test__compute_topic_modeling_sampling_records_before_after_sizes(
    tmp_path, monkeypatch
):
    seen_docs: dict[str, int] = {}

    def fake_run(*, all_docs, **_kwargs):
        seen_docs["count"] = len(all_docs)
        documents = [
            {"doc_index": i, "dominant_topic": 0} for i in range(len(all_docs))
        ]
        return _canned_rust_result(
            documents=documents,
            topics=[{"id": 0, "representative_words": _terms("x"), "x": 0.0, "y": 0.0}],
        )

    monkeypatch.setattr(topic_modeling, "_run_rust_topic_modeling", fake_run)

    corpus = [f"doc {i}" for i in range(20)]
    result = topic_modeling._compute_topic_modeling(
        workspace_id="w",
        corpora=[corpus],
        node_infos=[_node_info("n1")],
        artifact_dir=str(tmp_path),
        artifact_prefix="tm_sample",
        embedding_cache_path=str(tmp_path / "embeddings.duckdb"),
        sample_fractions=[0.5],
    )

    assert seen_docs["count"] == 10
    assert result["meta"]["corpus_sizes_before_sample"] == [20]
    assert result["meta"]["corpus_sizes_after_sample"] == [10]


def test__compute_topic_modeling_uses_fixed_internal_cluster_size(
    tmp_path, monkeypatch
):
    """The removed public parameter cannot alter HDBSCAN leaf construction."""
    captured_kwargs: dict[str, Any] = {}

    def fake_run(**kwargs):
        captured_kwargs.update(kwargs)
        return _canned_rust_result(
            documents=[
                {"doc_index": 0, "dominant_topic": 0},
                {"doc_index": 1, "dominant_topic": 1},
            ],
            topics=[
                {"id": 0, "representative_words": _terms("a"), "x": 0.0, "y": 0.0},
                {"id": 1, "representative_words": _terms("b"), "x": 1.0, "y": 1.0},
            ],
        )

    monkeypatch.setattr(topic_modeling, "_run_rust_topic_modeling", fake_run)

    result = topic_modeling._compute_topic_modeling(
        workspace_id="w",
        corpora=[["doc one", "doc two"]],
        node_infos=[_node_info("n1")],
        artifact_dir=str(tmp_path),
        artifact_prefix="tm_min",
        embedding_cache_path=str(tmp_path / "embeddings.duckdb"),
    )

    assert captured_kwargs["min_cluster_size"] == 10
    assert "min_topic_size" not in result["meta"]
    assert result["clustering"]["max_cluster_count"] == 2
