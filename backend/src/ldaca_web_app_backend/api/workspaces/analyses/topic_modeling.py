"""Topic Modeling analysis endpoints extracted from workspaces monolith."""

import math

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.json_utils import json_sanitize
from ....core.workspace import workspace_manager
from ....models import TopicModelingRequest, TopicModelingResponse
from ..utils import get_workspace_or_404

router = APIRouter(prefix="/workspaces", tags=["topic-modeling"])


@router.post(
    "/{workspace_id}/topic-modeling",
    response_model=TopicModelingResponse,
)
async def run_topic_modeling(
    workspace_id: str,
    request: TopicModelingRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]

    get_workspace_or_404(user_id, workspace_id)

    task_manager = get_task_manager(user_id, workspace_id)

    # Return running task if present
    for task in task_manager.tasks.values():
        if (
            task.status == AnalysisStatus.RUNNING
            and task.request
            and hasattr(task.request, "__class__")
            and task.request.__class__.__name__ == "TopicModelingRequest"
        ):
            return TopicModelingResponse(
                state="running",
                message="Topic Modeling analysis already running",
                data=None,
                metadata={"task_id": task.task_id},
            )

    # Reject if background manager already has running analysis task
    tm = workspace_manager.get_task_manager(user_id, workspace_id)
    try:
        if tm and tm.any_running():
            raise HTTPException(
                status_code=409,
                detail="Another analysis task is currently running. Please wait for it to complete before starting Topic Modeling.",
            )
    except AttributeError:
        pass

    corpora: list[list[str]] = []
    node_names: list[str] = []

    for node_id in request.node_ids:
        node = workspace_manager.get_node_from_workspace(user_id, workspace_id, node_id)
        if not node:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

        node_data = getattr(node, "data", None)
        if not isinstance(node_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} data must be a LazyFrame",
            )

        node_name = node.name if hasattr(node, "name") else node_id
        available_columns = list(node_data.collect_schema().names())

        column_name = request.node_columns.get(node_id)
        if not column_name:
            metadata = getattr(node, "metadata", {}) or {}
            if isinstance(metadata, dict):
                column_name = metadata.get("text_column")
            if not column_name:
                common_text_columns = [
                    col
                    for col in ["document", "text", "content", "body", "message"]
                    if col in available_columns
                ]
                if common_text_columns:
                    column_name = common_text_columns[0]

        if not column_name:
            raise HTTPException(
                status_code=400,
                detail=f"Could not determine text column for node {node_id}. Available columns: {available_columns}",
            )

        if column_name not in available_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column_name}' not found in node {node_id}. Available columns: {available_columns}",
            )

        selected_data = node_data.select(
            pl.col(column_name).alias("__doc_col__")
        ).collect()
        docs = [
            str(val) if val is not None else ""
            for val in selected_data["__doc_col__"].to_list()
        ]
        corpora.append(docs)
        node_names.append(node_name)

    # Keep native fast path for stable behavior
    use_native = True

    if use_native:
        import polars_text as pt

        all_docs = [doc for corpus in corpora for doc in corpus]
        corpus_sizes = [len(corpus) for corpus in corpora]

        if not all_docs:
            tv_data = {
                "topics": [],
                "corpus_sizes": corpus_sizes,
                "per_corpus_topic_counts": [],
                "meta": {},
            }
        else:
            series = pl.Series("text", all_docs)
            topics_map, doc_topics = pt.topic_modeling(
                series,
                min_points=request.min_topic_size,
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

            tv_data = {
                "topics": topic_payloads,
                "corpus_sizes": corpus_sizes,
                "per_corpus_topic_counts": per_corpus_topic_counts,
                "meta": {"native": True},
            }
    else:
        raise HTTPException(status_code=501, detail="Fallback path removed")

    result_payload = {
        "topics": tv_data["topics"],
        "corpus_sizes": tv_data["corpus_sizes"],
        "per_corpus_topic_counts": tv_data.get("per_corpus_topic_counts"),
        "meta": {**tv_data.get("meta", {}), "node_names": node_names},
    }

    serialized_result_payload = json_sanitize(result_payload)

    analysis_task = AnalysisTask(
        task_id="topic_modeling_current",
        user_id=user_id,
        workspace_id=workspace_id,
        request=request,
        status=AnalysisStatus.COMPLETED,
        result=GenericAnalysisResult(serialized_result_payload),
    )
    task_manager.save_task(analysis_task)

    return TopicModelingResponse(
        state="successful",
        message="Topic Modeling analysis complete",
        data=serialized_result_payload,
        metadata={"task_id": "topic_modeling_current"},
    )
