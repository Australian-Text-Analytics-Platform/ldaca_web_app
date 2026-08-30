"""Process-worker implementation for topic-modeling analysis.

Used by:
- canonical Analysis execution and backend tests that exercise topic-modeling
  computation from immutable inputs.

Flow: load workspace corpora, choose sampling and embedding settings, build topic
    payloads, and return private artifacts to the Analysis service.

The implementation is split across several sub-modules:
- ``topic_types`` — internal frozen dataclasses
- ``topic_pipeline`` — corpus sampling, c-TF-IDF vectorizer/stopword
  selection, and the Rust-pipeline runner
- ``topic_result`` — result payload building and exact reduction

Embedding, dimensionality reduction, clustering, and c-TF-IDF labeling all run
inside the ``polars_text`` Rust extension; there is no Python BERTopic or
SentenceTransformer dependency anymore.
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Any
from collections.abc import Callable

from ..analysis.topic_inclusion import topic_inclusion_descriptor
from .topic_pipeline import (
    _resolve_vectorizer_model,
    _run_rust_topic_modeling,
    _sample_corpora_for_topic_modeling,
)
from .topic_result import (
    _build_empty_topic_payload,
    _build_topic_projection_basis,
    _build_topic_projection_payload,
    _distribution_by_doc_index,
)
from .topic_types import _PreparedTopicPayload
from .utils import process_entrypoint

# Default ONNX embedder used by the Rust ORT pipeline when no override is given.
# Recorded in result metadata so the API/frontend can report which model was
# used; the actual download/loading is handled inside ``polars_text``.
_DEFAULT_EMBEDDER_MODEL = "onnx-community/all-MiniLM-L6-v2-ONNX"

logger = logging.getLogger(__name__)

__all__ = [
    "run_topic_modeling_analysis",
    "run_topic_modeling_data_block_creation",
]


@process_entrypoint
def run_topic_modeling_data_block_creation(
    *,
    input_snapshot_dir: str,
    output_dir: str,
    request_payload: dict[str, Any],
    clustering_context_path: str,
    source_projection: dict[str, dict[str, Any]],
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """Materialize selected Topic Modelling rows and meanings as Data Blocks."""

    import polars as pl

    from ..analysis.generated_columns import (
        TOPIC_COLUMN,
        TOPIC_DISTRIBUTION_COLUMN,
        TOPIC_DISTRIBUTION_OUTPUT_COLUMN,
        TOPIC_MEANING_COLUMN,
        TOPIC_TOP1_COLUMN,
    )
    from ..analysis.topic_inclusion import top_topic_ids
    from ..domain.workspace import TopicModelingDataBlockCreationAnalysisRequest
    from ..shared.topic_types import topic_distribution_dtype
    from .input_snapshots import load_snapshot_node

    request = TopicModelingDataBlockCreationAnalysisRequest.model_validate(request_payload)
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    from .topic_pipeline import _project_rust_topic_modeling

    projection = _project_rust_topic_modeling(
        clustering_context=Path(clustering_context_path).read_bytes(),
        cluster_count=request.cluster_count,
        document_count=sum(int(item["size"]) for item in source_projection.values()),
    )
    meaning_values = {
        int(topic["id"]): [
            str(candidate["word"])
            for candidate in topic.get("representative_words") or []
        ]
        for topic in projection["topics"]
    }
    meaning_values.update(
        {item.topic_id: list(item.words) for item in request.topic_meanings_override}
    )

    outputs: list[dict[str, Any]] = []
    total = len(request.node_ids)
    for index, source_uuid in enumerate(request.node_ids):
        source_id = str(source_uuid)
        source = load_snapshot_node(input_snapshot_dir, source_id)
        selected_columns = list(request.selected_columns[source_uuid])
        schema = source.data.collect_schema()
        missing = [column for column in selected_columns if column not in schema]
        if missing:
            raise ValueError(f"Topic Modelling Data Block Creation columns not found: {missing}")
        source_context = source_projection.get(source_id)
        if source_context is None:
            raise ValueError("Topic Modelling source projection is unavailable")
        offset = int(source_context["offset"])
        size = int(source_context["size"])
        row_indices = list(source_context["row_indices"])
        projected_documents = projection["documents"][offset : offset + size]
        selected_topic_ids = set(request.topic_ids or [])
        included_rows: list[int] = []
        included_top_topics: set[int] = set()
        for row_offset, document in enumerate(projected_documents):
            row_topics = top_topic_ids(
                document.get("topic_distribution") or [],
                request.cluster_count,
                request.top_n_topics,
            )
            if selected_topic_ids and not row_topics.intersection(selected_topic_ids):
                continue
            included_rows.append(row_offset)
            included_top_topics.update(row_topics)
        padded_distributions = _distribution_by_doc_index(
            [
                {
                    "doc_index": row_offset,
                    "topic_distribution": document.get("topic_distribution") or [],
                }
                for row_offset, document in enumerate(projected_documents)
            ],
            size,
            list(range(request.cluster_count)),
        )
        assignments = pl.DataFrame(
            {
                "__row_nr__": pl.Series(
                    "__row_nr__",
                    [row_indices[row_offset] for row_offset in included_rows],
                    dtype=pl.Int64,
                ),
                TOPIC_COLUMN: pl.Series(
                    TOPIC_COLUMN,
                    [
                        int(projected_documents[row_offset]["dominant_topic"])
                        for row_offset in included_rows
                    ],
                    dtype=pl.Int64,
                ),
                TOPIC_DISTRIBUTION_COLUMN: pl.Series(
                    TOPIC_DISTRIBUTION_COLUMN,
                    [padded_distributions[row_offset] for row_offset in included_rows],
                    dtype=topic_distribution_dtype(request.cluster_count),
                ),
            }
        ).lazy()
        joined = (
            source.data.with_row_index("__row_nr__")
            .with_columns(pl.col("__row_nr__").cast(pl.Int64))
            .join(assignments, on="__row_nr__", how="inner", maintain_order="left")
            .select(
                *[pl.col(column) for column in selected_columns],
                pl.col(TOPIC_COLUMN).alias(TOPIC_TOP1_COLUMN),
                pl.col(TOPIC_DISTRIBUTION_COLUMN).alias(
                    TOPIC_DISTRIBUTION_OUTPUT_COLUMN
                ),
            )
        )
        topic_data_id = uuid.uuid4()
        topic_meanings_id = uuid.uuid4()
        topic_data_path = destination / f"{topic_data_id}.parquet"
        joined.sink_parquet(topic_data_path)
        topic_data = pl.scan_parquet(topic_data_path)
        output_columns = topic_data.collect_schema().names()
        record_count = int(topic_data.select(pl.len()).collect().item())
        present_topic_ids = sorted(included_top_topics)
        topic_meanings_frame = pl.DataFrame(
            {
                TOPIC_COLUMN: present_topic_ids,
                TOPIC_MEANING_COLUMN: [
                    meaning_values.get(topic_id, []) for topic_id in present_topic_ids
                ],
            },
            schema={
                TOPIC_COLUMN: pl.Int64,
                TOPIC_MEANING_COLUMN: pl.List(pl.String),
            },
        )
        topic_meanings_output_path = destination / f"{topic_meanings_id}.parquet"
        topic_meanings_frame.lazy().sink_parquet(topic_meanings_output_path)

        topic_name = request.new_node_names[source_uuid]
        topic_data_provenance = {
            "type": "derivation",
            "operation": {
                "kind": "topic_modeling_data_block_creation",
                "role": "topic_data",
                "cluster_count": request.cluster_count,
                "top_n_topics": request.top_n_topics,
            },
            "inputs": [
                {
                    "role": "source",
                    "value": {"type": "node", "node_id": source_id},
                }
            ],
        }
        topic_meanings_provenance = {
            "type": "derivation",
            "operation": {
                "kind": "topic_modeling_data_block_creation",
                "role": "topic_meanings",
                "cluster_count": request.cluster_count,
                "top_n_topics": request.top_n_topics,
            },
            "inputs": [
                {
                    "role": "source",
                    "value": {"type": "node", "node_id": str(topic_data_id)},
                }
            ],
        }
        outputs.append(
            {
                "source_node_id": source_id,
                "topic_data": {
                    "data_block": {
                        "id": str(topic_data_id),
                        "name": topic_name,
                        "provenance": topic_data_provenance,
                        "document": source.document
                        if source.document in selected_columns
                        else None,
                        "color": None,
                    },
                    "parquet_path": str(topic_data_path),
                    "output_columns": output_columns,
                    "record_count": record_count,
                },
                "topic_meanings": {
                    "data_block": {
                        "id": str(topic_meanings_id),
                        "name": f"{topic_name} topic meanings",
                        "provenance": topic_meanings_provenance,
                        "document": None,
                        "color": None,
                    },
                    "parquet_path": str(topic_meanings_output_path),
                    "output_columns": [TOPIC_COLUMN, TOPIC_MEANING_COLUMN],
                    "record_count": len(present_topic_ids),
                },
            }
        )
        if progress_callback:
            progress_callback(
                0.95 * (index + 1) / total,
                "Publishing Topic Modelling results...",
            )
    return {
        "state": "successful",
        "outputs": outputs,
        "message": "Topic Modelling results added to the Workspace",
    }


# ---------------------------------------------------------------------------
# Main pipeline stages
# ---------------------------------------------------------------------------


def _load_corpora_from_snapshot(
    input_snapshot_dir: str,
    node_payloads: list[dict[str, Any]],
) -> list[list[str]]:
    """Return raw document lists from Analysis-owned node plan snapshots.

    Called by:
    - ``_prepare_payload`` when the Analysis invocation contains immutable
      snapshot references instead of eagerly collected corpora.

    Flow: load each snapshotted LazyFrame, enrich ``node_payloads`` with display
    names and source schema metadata, and collect the selected text column inside
    the worker process.
    """

    import polars as pl

    from .input_snapshots import load_snapshot_node

    raw_corpora: list[list[str]] = []
    for node_info in node_payloads:
        node_id = str(node_info.get("node_id") or "")
        text_column = str(node_info.get("text_column") or "")
        if not node_id or not text_column:
            raise ValueError(
                "Topic modeling requires node_id and text_column for each node"
            )

        snapshot_node = load_snapshot_node(input_snapshot_dir, node_id)
        node_info.setdefault("node_name", snapshot_node.name)
        node_info.setdefault(
            "original_columns",
            list(snapshot_node.data.collect_schema().names()),
        )
        selected = snapshot_node.data.select(
            pl.col(text_column).alias("__doc_col__")
        ).collect()
        raw_corpora.append(
            [
                str(value) if value is not None else ""
                for value in selected["__doc_col__"].to_list()
            ]
        )
    return raw_corpora


def _prepare_payload(
    *,
    node_infos: list[dict[str, Any]],
    artifact_dir: str,
    corpora: list[list[str]] | None,
    input_snapshot_dir: str | None,
    progress_callback: Callable[[float, str], None] | None,
) -> _PreparedTopicPayload:
    """Prepare payload data consumed by topic-modeling worker pipeline.

    Called by:
    - ``run_topic_modeling_analysis`` (this module).

    Flow: load workspace corpora, choose sampling and embedding settings, build
        topic payloads, and return artifacts to the Analysis service.
    """
    artifact_root = Path(artifact_dir)
    artifact_root.mkdir(parents=True, exist_ok=True)

    if corpora is None:
        if input_snapshot_dir is not None:
            if progress_callback:
                progress_callback(
                    0.03, "Loading source documents from Analysis snapshot..."
                )
            corpora = _load_corpora_from_snapshot(input_snapshot_dir, node_infos)
        else:
            raise ValueError("Topic modeling requires corpora or input_snapshot_dir")

    if len(corpora) != len(node_infos):
        raise ValueError(
            "Topic modeling payload mismatch: corpora and node_infos lengths differ"
        )

    if progress_callback:
        progress_callback(0.05, "Preparing topic modelling payload...")

    node_names = [
        str(info.get("node_name") or info.get("node_id") or "node")
        for info in node_infos
    ]
    return _PreparedTopicPayload(
        artifact_root=artifact_root,
        corpora=corpora,
        node_names=node_names,
    )


def _compute_topic_payload(
    *,
    embedding_cache_path: str,
    node_infos: list[dict[str, Any]],
    corpora: list[list[str]],
    artifact_root: Path,
    artifact_prefix: str,
    min_cluster_size: int,
    random_seed: int,
    progress_callback: Callable[[float, str], None] | None,
    sample_fractions: list[float | None] | None,
    segmentation_method: str,
    max_segment_tokens: int,
) -> dict[str, Any]:
    """Run the full topic-modeling pipeline: sample, run Rust, build the payload.

    Called by:
    - ``run_topic_modeling_analysis`` (this module).

    Flow: sample each corpus, pick the c-TF-IDF vectorizer from the
    document script mix, call the Rust pipeline (chunk -> ORT embed -> PaCMAP
    -> HDBSCAN -> c-TF-IDF, plus optional merge for target/exact modes), and turn
    its JSON result into the wire payload. For ``exact`` mode it also persists a
    JSON re-aggregation context so the slider can request a different count later.
    """
    sampled = _sample_corpora_for_topic_modeling(
        corpora=corpora,
        sample_fractions=sample_fractions,
        random_seed=random_seed,
    )
    if not sampled.all_docs:
        return _build_empty_topic_payload(
            sampled=sampled,
            node_infos=node_infos,
            artifact_root=artifact_root,
            artifact_prefix=artifact_prefix,
        )

    if any(size == 0 for size in sampled.corpus_sizes):
        raise ValueError("All corpora must contain at least one document.")

    random_state = int(random_seed)
    vectorizer_model = _resolve_vectorizer_model(sampled.all_docs)

    logger.info(
        "[Worker %d] Running Rust topic-modeling pipeline (%d docs, min_cluster_size=%d)",
        os.getpid(),
        len(sampled.all_docs),
        min_cluster_size,
    )
    if progress_callback:
        progress_callback(0.1, "Embedding and clustering Topic Segments...")

    rust_result = _run_rust_topic_modeling(
        all_docs=sampled.all_docs,
        seed=random_state,
        min_cluster_size=min_cluster_size,
        vectorizer_model=vectorizer_model,
        embedder_model=_DEFAULT_EMBEDDER_MODEL,
        embedding_cache=embedding_cache_path,
        segmentation_method=segmentation_method,
        max_segment_tokens=max_segment_tokens,
    )

    if progress_callback:
        progress_callback(0.85, "Assembling topic results...")

    basis = _build_topic_projection_basis(
        rust_result=rust_result,
        corpus_sizes=sampled.corpus_sizes,
    )
    topic_inclusion = topic_inclusion_descriptor(len(basis["topics"]))
    payload = _build_topic_projection_payload(
        basis=basis,
        node_infos=node_infos,
        corpus_sizes=sampled.corpus_sizes,
        top_n_topics=int(topic_inclusion["top_n_topics"]),
    )
    context_path = artifact_root / f"{artifact_prefix}_topic_clustering_context.msgpack.zst"
    context_path.write_bytes(rust_result["clustering_context"])
    natural_count = len(payload["topics"])
    payload["clustering"] = {
        "cluster_count": natural_count,
        "min_cluster_count": 2 if natural_count >= 2 else natural_count,
        "max_cluster_count": natural_count,
        "default_cluster_count": natural_count,
        "adjustable": natural_count > 2,
    }
    payload["clustering_context"] = {
        "version": 1,
        "artifact": str(context_path),
        "source_row_indices": sampled.active_corpora_indices,
    }
    payload_meta = payload["meta"]
    payload_meta.update(
        {
            "native": True,
            "engine": "rust",
            "embedding_model": _DEFAULT_EMBEDDER_MODEL,
            "embedding_backend": "ort",
            "random_state": random_state,
            "vectorizer_model": vectorizer_model,
            "n_chunks": int(rust_result.get("n_chunks") or 0),
            "truncated_segment_count": int(
                rust_result.get("truncated_segment_count") or 0
            ),
            **(
                {
                    "corpus_sizes_before_sample": sampled.corpus_sizes_before_sample,
                    "corpus_sizes_after_sample": sampled.corpus_sizes,
                }
                if sample_fractions is not None
                else {}
            ),
        }
    )
    stage_timings = rust_result.get("stage_timings_ms")
    if isinstance(stage_timings, list):
        payload_meta["stage_timings_ms"] = stage_timings
    payload["meta"] = payload_meta
    return payload


def _compute_topic_modeling(
    workspace_id: str,
    node_infos: list[dict[str, Any]],
    artifact_dir: str,
    artifact_prefix: str,
    embedding_cache_path: str,
    min_cluster_size: int = 10,
    input_snapshot_dir: str | None = None,
    corpora: list[list[str]] | None = None,
    random_seed: int = 0,
    segmentation_method: str = "automatic",
    max_segment_tokens: int = 256,
    progress_callback: Callable[[float, str], None] | None = None,
    sample_fractions: list[float | None] | None = None,
) -> dict[str, Any]:
    """Execute topic modeling in a worker process.

    Used by:
    - canonical topic-modeling Analysis execution, which owns submission,
      progress, cancellation, and artifact cleanup.
        Why:
        - Runs the Rust ``polars_text`` topic-modeling pipeline (ORT embeddings
            + PaCMAP + HDBSCAN + c-TF-IDF) out-of-process and returns an artifact
            manifest (Parquet outputs) for main-process lazy retrieval/finalization.

    ``min_cluster_size`` controls the smallest HDBSCAN cluster in the initial
    natural fit. The Rust pipeline manages its own in-process embedder and
    DuckDB embedding cache.

    Flow: load workspace corpora, sample, run the Rust pipeline, build topic
        payloads, and return artifacts to the Analysis service.
    """
    try:
        if progress_callback:
            progress_callback(
                0.01,
                "Loading topic modelling resources. First runs may download model files...",
            )

        logger.info(
            "[Worker %d] Starting topic-modeling Analysis for workspace %s",
            os.getpid(),
            workspace_id,
        )

        prepared_payload = _prepare_payload(
            node_infos=node_infos,
            artifact_dir=artifact_dir,
            corpora=corpora,
            input_snapshot_dir=input_snapshot_dir,
            progress_callback=progress_callback,
        )

        if progress_callback:
            progress_callback(0.07, "Loading embedding model...")

        topic_payload = _compute_topic_payload(
            embedding_cache_path=embedding_cache_path,
            node_infos=node_infos,
            corpora=prepared_payload.corpora,
            artifact_root=prepared_payload.artifact_root,
            artifact_prefix=artifact_prefix,
            min_cluster_size=min_cluster_size,
            random_seed=random_seed,
            progress_callback=progress_callback,
            sample_fractions=sample_fractions,
            segmentation_method=segmentation_method,
            max_segment_tokens=max_segment_tokens,
        )

        if progress_callback:
            progress_callback(0.9, "Writing topic-modelling results...")

        result = {
            "topics": topic_payload["topics"],
            "corpus_sizes": topic_payload["corpus_sizes"],
            "per_corpus_topic_counts": topic_payload["per_corpus_topic_counts"],
            "sources": topic_payload["sources"],
            "clustering": topic_payload["clustering"],
            "topic_inclusion": topic_payload["topic_inclusion"],
            "clustering_context": topic_payload["clustering_context"],
            "meta": {
                **topic_payload["meta"],
                "node_names": prepared_payload.node_names,
            },
        }

        logger.info("[Worker %d] Topic modeling completed successfully", os.getpid())
        return result

    except Exception as e:
        logger.error("[Worker %d] Topic modeling failed: %s", os.getpid(), e)
        raise


@process_entrypoint
def run_topic_modeling_analysis(
    *,
    user_id: str,
    workspace_id: str,
    node_infos: list[dict[str, Any]],
    artifact_dir: str,
    artifact_prefix: str,
    input_snapshot_dir: str,
    embedding_cache_path: str,
    min_cluster_size: int = 10,
    random_seed: int = 0,
    segmentation_method: str = "automatic",
    max_segment_tokens: int = 256,
    progress_callback: Callable[[float, str], None] | None = None,
    sample_fractions: list[float | None] | None = None,
) -> dict[str, Any]:
    """Run the canonical snapshot-only topic-modeling process contract."""

    return _compute_topic_modeling(
        workspace_id=workspace_id,
        node_infos=node_infos,
        artifact_dir=artifact_dir,
        artifact_prefix=artifact_prefix,
        input_snapshot_dir=input_snapshot_dir,
        corpora=None,
        min_cluster_size=min_cluster_size,
        random_seed=random_seed,
        segmentation_method=segmentation_method,
        max_segment_tokens=max_segment_tokens,
        progress_callback=progress_callback,
        sample_fractions=sample_fractions,
        embedding_cache_path=embedding_cache_path,
    )
