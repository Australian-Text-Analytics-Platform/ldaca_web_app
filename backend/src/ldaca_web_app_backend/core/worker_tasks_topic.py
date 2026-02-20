"""Topic modeling worker task implementation."""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

_EMBEDDER_CACHE: dict[str, Any] = {}


def _get_embedder(model_name: str):
    """Get or create a cached sentence-transformer embedder per worker process."""
    embedder = _EMBEDDER_CACHE.get(model_name)
    if embedder is not None:
        return embedder

    from sentence_transformers import SentenceTransformer

    embedder = SentenceTransformer(model_name)
    _EMBEDDER_CACHE[model_name] = embedder
    return embedder


def run_topic_modeling_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    corpora: list[list[str]],
    node_infos: list[Dict[str, Any]],
    min_topic_size: int = 5,
    use_ctfidf: bool = False,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute topic modeling in a worker process.

    Used by:
    - `core.worker.topic_modeling_task`
    - `TASK_REGISTRY["topic_modeling"]`

    Why:
    - Runs BERTopic embedding/modeling out-of-process and returns both user
      payload and cache data for detach workflows.
    """
    configure_worker_environment()

    try:
        import numpy as np
        import polars as pl
        from bertopic import BERTopic
        from bertopic._utils import select_topic_representation

        print(
            f"[Worker {os.getpid()}] Starting topic modeling task for workspace {workspace_id}"
        )

        if len(corpora) != len(node_infos):
            raise ValueError(
                "Topic modeling payload mismatch: corpora and node_infos lengths differ"
            )

        if progress_callback:
            progress_callback(0.2, "Preparing topic modeling payload...")

        node_names = [
            str(info.get("node_name") or info.get("node_id") or "node")
            for info in node_infos
        ]

        if progress_callback:
            progress_callback(0.5, "Payload ready; running topic modeling...")

        if progress_callback:
            progress_callback(0.6, "Running topic modeling...")

        def _compute_topics() -> dict[str, Any]:
            all_docs = [doc for corpus in corpora for doc in corpus]
            corpus_sizes = [len(corpus) for corpus in corpora]
            if not all_docs:
                return {
                    "topics": [],
                    "corpus_sizes": corpus_sizes,
                    "per_corpus_topic_counts": [],
                    "assignments": [],
                    "cache_payload": {"nodes": []},
                    "meta": {},
                }

            if any(size == 0 for size in corpus_sizes):
                raise ValueError("All corpora must contain at least one document.")

            random_state = 42
            embedding_model_name = "all-MiniLM-L6-v2"

            # Build embeddings once for downstream cache + BERTopic fitting.
            embedder = _get_embedder(embedding_model_name)
            all_embeddings = embedder.encode(all_docs, show_progress_bar=False)
            embedding_rows = all_embeddings.tolist()

            # Reuse the same loaded embedder instance to avoid loading model
            # weights twice in a single task.
            topic_model = BERTopic(
                verbose=False,
                min_topic_size=int(min_topic_size),
                embedding_model=embedder,
            )
            assigned_topics, _ = topic_model.fit_transform(all_docs, all_embeddings)

            assignments: list[list[int]] = []
            cache_nodes: list[dict[str, Any]] = []
            offset = 0
            for idx, corpus in enumerate(corpora):
                size = len(corpus)
                end = offset + size
                corpus_topics = assigned_topics[offset:end]
                corpus_embeddings = embedding_rows[offset:end]
                normalized_topics = [
                    int(topic_id) if isinstance(topic_id, (int, np.integer)) else -1
                    for topic_id in corpus_topics
                ]
                assignments.append(normalized_topics)
                cache_nodes.append({
                    "node_id": node_infos[idx]["node_id"],
                    "node_name": node_infos[idx]["node_name"],
                    "text_column": node_infos[idx]["text_column"],
                    "original_columns": node_infos[idx]["original_columns"],
                    "embeddings": corpus_embeddings,
                    "topics": normalized_topics,
                })
                offset = end

            per_corpus_topic_counts: list[dict[int, int]] = []
            for corpus_topics in assignments:
                counts: dict[int, int] = {}
                for topic_id in corpus_topics:
                    counts[topic_id] = counts.get(topic_id, 0) + 1
                per_corpus_topic_counts.append(counts)

            # External BERTopic output is pandas; convert to polars before processing.
            topic_freq_pd = topic_model.get_topic_freq()
            topic_freq = (
                pl.from_pandas(topic_freq_pd)
                if topic_freq_pd is not None
                else pl.DataFrame(schema={"Topic": pl.Int64})
            )

            topic_ids: list[int] = []
            if "Topic" in topic_freq.columns and not topic_freq.is_empty():
                topic_ids = [
                    int(topic_id)
                    for topic_id in topic_freq
                    .filter(pl.col("Topic") != -1)
                    .get_column("Topic")
                    .to_list()
                    if isinstance(topic_id, (int, np.integer))
                ]

            labels: list[str] = []
            for topic_id in topic_ids:
                words = topic_model.get_topic(topic_id) or []
                top_words = [
                    word for word, _score in words[:5] if isinstance(word, str) and word
                ]
                labels.append(
                    " | ".join(top_words) if top_words else f"Topic {topic_id}"
                )

            all_topics_sorted = sorted(list(topic_model.get_topics().keys()))
            indices = (
                np.array([all_topics_sorted.index(topic_id) for topic_id in topic_ids])
                if topic_ids
                else np.array([])
            )

            embeddings, c_tfidf_used = select_topic_representation(
                topic_model.c_tf_idf_,
                topic_model.topic_embeddings_,
                use_ctfidf=bool(use_ctfidf),
                output_ndarray=True,
            )
            if len(indices) > 0:
                embeddings = embeddings[indices]
            else:
                embeddings = np.zeros((0, 2))

            if embeddings.shape[0] == 0:
                coords = embeddings
            elif embeddings.shape[0] == 1:
                coords = np.array([[0.0, 0.0]])
            elif embeddings.shape[0] <= 15:
                from sklearn.decomposition import PCA

                comps = min(2, embeddings.shape[1])
                projected = PCA(
                    n_components=comps, random_state=random_state
                ).fit_transform(embeddings)
                if comps == 1:
                    coords = np.column_stack([
                        projected[:, 0],
                        np.zeros_like(projected[:, 0]),
                    ])
                else:
                    coords = projected
            else:
                try:
                    from umap import UMAP

                    n_samples = embeddings.shape[0]
                    n_neighbors = max(2, min(15, n_samples - 2))
                    if c_tfidf_used:
                        from sklearn.preprocessing import MinMaxScaler

                        normalized = MinMaxScaler().fit_transform(embeddings)
                        coords = UMAP(
                            n_neighbors=n_neighbors,
                            n_components=2,
                            metric="hellinger",
                            random_state=random_state,
                        ).fit_transform(normalized)
                    else:
                        coords = UMAP(
                            n_neighbors=n_neighbors,
                            n_components=2,
                            metric="cosine",
                            random_state=random_state,
                        ).fit_transform(embeddings)
                except (
                    ImportError,
                    ModuleNotFoundError,
                    TypeError,
                    ValueError,
                    RuntimeError,
                ) as umap_error:
                    print(
                        f"[Worker {os.getpid()}] UMAP failed: {umap_error}. Falling back to PCA."
                    )
                    from sklearn.decomposition import PCA

                    comps = min(2, embeddings.shape[1])
                    projected = PCA(
                        n_components=comps, random_state=random_state
                    ).fit_transform(embeddings)
                    if comps == 1:
                        coords = np.column_stack([
                            projected[:, 0],
                            np.zeros_like(projected[:, 0]),
                        ])
                    else:
                        coords = projected

            topic_payloads = []
            for i, topic_id in enumerate(topic_ids):
                per_sizes = [
                    per_corpus_topic_counts[j].get(topic_id, 0)
                    for j in range(len(per_corpus_topic_counts))
                ]
                topic_payloads.append({
                    "id": topic_id,
                    "label": labels[i] if i < len(labels) else f"Topic {topic_id}",
                    "size": per_sizes,
                    "total_size": int(sum(per_sizes)),
                    "x": float(coords[i, 0]) if i < len(coords) else 0.0,
                    "y": float(coords[i, 1]) if i < len(coords) else 0.0,
                })

            return {
                "topics": topic_payloads,
                "corpus_sizes": corpus_sizes,
                "per_corpus_topic_counts": per_corpus_topic_counts,
                "assignments": assignments,
                "cache_payload": {"nodes": cache_nodes},
                "meta": {
                    "native": True,
                    "engine": "bertopic",
                    "embedding_model": embedding_model_name,
                    "used_ctfidf": bool(use_ctfidf),
                    "use_ctfidf": bool(use_ctfidf),
                    "embeddings_from_ctfidf": bool(c_tfidf_used),
                    "min_topic_size": int(min_topic_size),
                    "total_topics_incl_outlier": int(topic_freq.height),
                    "random_state": random_state,
                },
            }

        try:
            tv = _compute_topics()
        except Exception as e:
            raise RuntimeError(f"BERTopic topic modeling failed: {e}") from e

        if progress_callback:
            progress_callback(0.9, "Finalizing results...")

        result = {
            "topics": tv["topics"],
            "corpus_sizes": tv["corpus_sizes"],
            "per_corpus_topic_counts": tv.get("per_corpus_topic_counts"),
            "cache_payload": tv.get("cache_payload", {"nodes": []}),
            "meta": {**tv.get("meta", {}), "node_names": node_names},
        }

        if progress_callback:
            progress_callback(1.0, "Completed successfully")

        print(f"[Worker {os.getpid()}] Topic modeling completed successfully")
        return result

    except Exception as e:
        print(f"[Worker {os.getpid()}] Topic modeling failed: {str(e)}")
        if progress_callback:
            progress_callback(-1, f"Failed: {str(e)}")
        raise
