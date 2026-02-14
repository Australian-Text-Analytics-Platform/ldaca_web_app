"""Topic modeling worker task implementation."""

from __future__ import annotations

import math
import os
from typing import Any, Dict, Optional


def run_topic_modeling_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    node_ids: list[str],
    node_columns: Dict[str, str],
    min_topic_size: int = 5,
    use_ctfidf: bool = False,
    progress_callback: Optional[callable] = None,
) -> Dict[str, Any]:
    """Execute topic modeling in a worker process."""
    configure_worker_environment()

    try:
        import polars as pl
        import polars_text as pt
        from ldaca_web_app_backend.core.workspace import workspace_manager

        print(
            f"[Worker {os.getpid()}] Starting topic modeling task for workspace {workspace_id}"
        )

        if progress_callback:
            progress_callback(0.1, "Initializing workspace...")

        workspace = workspace_manager.get_workspace(user_id, workspace_id)
        if not workspace:
            success = workspace_manager.set_current_workspace(user_id, workspace_id)
            if success:
                workspace = workspace_manager.get_workspace(user_id, workspace_id)

        if not workspace:
            raise ValueError(
                f"Workspace {workspace_id} not found (worker process cannot access workspace)"
            )

        if progress_callback:
            progress_callback(0.2, "Loading node data...")

        corpora = []
        node_names = []

        for i, node_id in enumerate(node_ids):
            node = workspace_manager.get_node_from_workspace(
                user_id, workspace_id, node_id
            )
            if not node:
                raise ValueError(f"Node {node_id} not found")

            node_data = getattr(node, "data", None)
            if not isinstance(node_data, pl.LazyFrame):
                raise ValueError(f"Node {node_id} data must be a LazyFrame")

            node_name = getattr(node, "name", None) or node_id
            available_columns = list(node_data.collect_schema().names())

            column_name = node_columns.get(node_id)
            if not column_name:
                metadata = getattr(node, "metadata", {}) or {}
                if isinstance(metadata, dict):
                    column_name = metadata.get("text_column")
                if not column_name:
                    common = [
                        c
                        for c in ["document", "text", "content", "body", "message"]
                        if c in available_columns
                    ]
                    if common:
                        column_name = common[0]

            if not column_name:
                raise ValueError(
                    f"Could not determine text column for node {node_id}. Available: {available_columns}"
                )

            if column_name not in available_columns:
                raise ValueError(
                    f"Column '{column_name}' not in node {node_id}. Available: {available_columns}"
                )

            sel_df = node_data.select(
                pl.col(column_name).alias("__doc_col__")
            ).collect()
            docs = [
                str(v) if v is not None else "" for v in sel_df["__doc_col__"].to_list()
            ]
            corpora.append(docs)
            node_names.append(node_name)

            if progress_callback:
                progress_callback(
                    0.2 + 0.3 * (i + 1) / len(node_ids), f"Loaded {node_name}"
                )

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
                    "meta": {},
                }

            series = pl.Series("text", all_docs)
            topics_map, doc_topics = pt.topic_modeling(
                series,
                min_points=min_topic_size,
            )

            top_topics: list[int] = []
            for row in doc_topics.to_list():
                if not row:
                    top_topics.append(-1)
                    continue
                best = max(row, key=lambda item: item.get("weight", 0.0))
                top_topics.append(int(best.get("topic_id", -1)))

            per_corpus_topic_counts: list[dict[int, int]] = []
            idx = 0
            for size in corpus_sizes:
                counts: dict[int, int] = {}
                for topic_id in top_topics[idx : idx + size]:
                    counts[topic_id] = counts.get(topic_id, 0) + 1
                per_corpus_topic_counts.append(counts)
                idx += size

            topic_ids = sorted(set(top_topics) | set(topics_map.keys()))
            topic_ids = [t for t in topic_ids if t != -1]
            topic_payloads = []
            if topic_ids:
                for i, topic_id in enumerate(topic_ids):
                    angle = 2 * math.pi * (i / max(len(topic_ids), 1))
                    x = float(math.cos(angle))
                    y = float(math.sin(angle))
                    per_sizes = [
                        per_corpus_topic_counts[j].get(topic_id, 0)
                        for j in range(len(per_corpus_topic_counts))
                    ]
                    total_size = sum(per_sizes)
                    label = topics_map.get(topic_id, f"Topic {topic_id}")
                    topic_payloads.append({
                        "id": topic_id,
                        "label": label,
                        "size": per_sizes,
                        "total_size": total_size,
                        "x": x,
                        "y": y,
                    })

            return {
                "topics": topic_payloads,
                "corpus_sizes": corpus_sizes,
                "per_corpus_topic_counts": per_corpus_topic_counts,
                "meta": {"native": True, "use_ctfidf": bool(use_ctfidf)},
            }

        try:
            tv = _compute_topics()
        except Exception as e:
            error_msg = str(e).lower()
            if any(
                phrase in error_msg
                for phrase in [
                    "no threading layer could be loaded",
                    "intel tbb",
                    "threading layer",
                    "tbb",
                    "numba_num_threads",
                    "threads have been launched",
                ]
            ):
                print(f"[Worker {os.getpid()}] WARNING: Threading error detected: {e}")
                print(
                    f"[Worker {os.getpid()}] INFO: Reconfiguring with safe threading and retrying..."
                )

                os.environ["NUMBA_THREADING_LAYER"] = "workqueue"
                os.environ["NUMBA_THREADING_LAYER_PRIORITY"] = "workqueue omp tbb"
                os.environ["NUMBA_NUM_THREADS"] = "1"

                try:
                    import numba

                    if hasattr(numba, "core") and hasattr(numba.core, "config"):
                        numba.core.config.THREADING_LAYER = "workqueue"
                except Exception:
                    pass

                print(
                    f"[Worker {os.getpid()}] INFO: Retrying topic modeling with workqueue threading..."
                )
                tv = _compute_topics()
                print(
                    f"[Worker {os.getpid()}] SUCCESS: Topic modeling succeeded with fallback threading"
                )
            else:
                raise

        if progress_callback:
            progress_callback(0.9, "Finalizing results...")

        result = {
            "topics": tv["topics"],
            "corpus_sizes": tv["corpus_sizes"],
            "per_corpus_topic_counts": tv.get("per_corpus_topic_counts"),
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
