"""AI annotation analysis endpoints (concordance-style on-demand pagination)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from uuid import uuid4

import polars as pl
from fastapi import APIRouter, Depends, HTTPException

from ....analysis.implementations.ai_annotation import (
    AiAnnotationRequest as AnalysisAiAnnotationRequest,
)
from ....analysis.manager import get_task_manager
from ....analysis.models import AnalysisStatus, AnalysisTask
from ....analysis.results import GenericAnalysisResult
from ....core.auth import get_current_user
from ....core.docworkspace_data_types import (
    ANNOTATION_POLARS_DTYPE,
    DocWorkspaceDataTypeUtils,
)
from ....core.workspace import workspace_manager
from ....models import (
    AiAnnotationDetachRequest,
    AiAnnotationRequest,
    AiAnnotationResultQuery,
    AiAnnotationSaveRequest,
)
from ..utils import update_workspace
from .ai_annotation_core import (
    DEFAULT_AI_ANNOTATION_PAGE,
    DEFAULT_AI_ANNOTATION_PAGE_SIZE,
    build_ai_annotation_response,
    normalize_saved_request,
)
from .current_tasks import get_current_task_ids_for_analysis

router = APIRouter(prefix="/workspaces", tags=["ai-annotation"])


def _prepare_ai_annotation_artifact_target(
    user_id: str, workspace_id: str
) -> tuple[str, str]:
    artifact_dir = workspace_manager.ensure_workspace_artifacts_dir(
        user_id, workspace_id
    )
    artifact_prefix = f"ai_annotation_detach_{uuid4().hex}"
    return str(artifact_dir), artifact_prefix


def _resolve_annotation_column(
    lf: pl.LazyFrame,
    preferred_column: str | None,
    text_column: str,
) -> str:
    schema = lf.collect_schema()
    if preferred_column:
        if preferred_column in schema:
            dtype = schema[preferred_column]
            if (
                DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(dtype)
                == "annotation"
            ):
                return preferred_column
        else:
            return preferred_column

    expected = f"{text_column}_annotation"
    if expected in schema:
        expected_type = schema[expected]
        if (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(expected_type)
            == "annotation"
        ):
            return expected

    for col_name, col_type in schema.items():
        if (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(col_type)
            == "annotation"
        ):
            return col_name

    return expected


def _normalize_annotation_entries(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        provider = str(item.get("provider") or "").strip()
        if not provider:
            continue
        normalized.append({
            "provider": provider,
            "annotation": str(item.get("annotation") or ""),
        })
    return normalized


def _merge_annotation(
    existing: Any,
    *,
    provider: str,
    annotation: str,
) -> list[dict[str, str]]:
    merged = _normalize_annotation_entries(existing)
    replaced = False
    for entry in merged:
        if entry.get("provider") == provider:
            entry["annotation"] = annotation
            replaced = True
            break
    if not replaced:
        merged.append({"provider": provider, "annotation": annotation})
    return merged


def _collect_with_temp_row_index(
    lf: pl.LazyFrame,
    base_name: str = "__row_index",
) -> tuple[pl.DataFrame, str]:
    """Collect a LazyFrame with a guaranteed-unique row index column name."""
    schema = lf.collect_schema()
    row_index_col = base_name
    suffix = 0
    while row_index_col in schema:
        suffix += 1
        row_index_col = f"{base_name}_{suffix}"

    collected = lf.with_row_index(row_index_col).collect()
    if not isinstance(collected, pl.DataFrame):
        raise HTTPException(status_code=500, detail="Failed to collect node data")
    return collected, row_index_col


def _internal_row_index_columns(columns: list[str]) -> list[str]:
    """Return internal temporary row-index column names to remove before persisting."""
    return [
        col
        for col in columns
        if col == "__row_index"
        or (col.startswith("__row_index_") and col[len("__row_index_") :].isdigit())
    ]


def _ensure_ai_annotator_import_path() -> None:
    backend_root = Path(__file__).resolve().parents[5]
    ai_annotator_root = backend_root / "ai-annotator"
    if str(ai_annotator_root) not in sys.path:
        sys.path.insert(0, str(ai_annotator_root))


def _apply_result_query_overrides(
    normalized_request: dict[str, Any],
    query: AiAnnotationResultQuery,
) -> dict[str, Any]:
    if query.page is not None:
        normalized_request["page"] = query.page
    if query.page_size is not None:
        normalized_request["page_size"] = query.page_size
    if query.sort_by is not None:
        normalized_request["sort_by"] = query.sort_by
    if query.descending is not None:
        normalized_request["descending"] = query.descending
    return normalized_request


@router.get("/ai-annotation/models")
async def get_ai_annotation_models(
    current_user: dict = Depends(get_current_user),
):
    del current_user
    _ensure_ai_annotator_import_path()

    try:
        from classifier_fastapi.modifiers import Modifier
        from classifier_fastapi.providers import LLMProvider
        from classifier_fastapi.techniques import Technique

        providers: dict[str, dict] = {}
        provider_warnings: list[str] = []
        for provider in LLMProvider:
            try:
                provider_props = provider.properties
                providers[provider.value] = {
                    "name": provider_props.name,
                    "description": provider_props.description,
                    "models": [
                        {
                            "name": model.id,
                            "full_name": model.name,
                            "description": model.description,
                            "context_window": model.context_window,
                        }
                        for model in provider_props.models
                    ],
                }
            except Exception as provider_error:
                provider_warnings.append(
                    f"Failed to load provider '{provider.value}': {provider_error}"
                )
                continue

        techniques = [
            {
                "name": technique.value,
                "description": technique.info.description,
                "explanation": technique.info.explanation,
            }
            for technique in Technique
        ]

        modifiers = [
            {
                "name": modifier.value,
                "description": modifier.properties.description,
                "explanation": modifier.properties.explanation,
            }
            for modifier in Modifier
        ]

        return {
            "state": "successful",
            "message": "AI annotation model catalog loaded",
            "data": {
                "providers": providers,
                "techniques": techniques,
                "modifiers": modifiers,
            },
            "metadata": {
                "warnings": provider_warnings,
            },
        }
    except ModuleNotFoundError:
        return {
            "state": "successful",
            "message": "AI annotation model catalog loaded with fallback defaults",
            "data": {
                "providers": {
                    "openai": {
                        "name": "OpenAI",
                        "description": "OpenAI API",
                        "models": [],
                    },
                    "ollama": {
                        "name": "Ollama",
                        "description": "Local Ollama endpoint",
                        "models": [],
                    },
                },
                "techniques": [
                    {
                        "name": "zero_shot",
                        "description": "Zero-shot prompting",
                        "explanation": "Classify without examples.",
                    },
                    {
                        "name": "few_shot",
                        "description": "Few-shot prompting",
                        "explanation": "Classify with demonstrations.",
                    },
                    {
                        "name": "chain_of_thought",
                        "description": "Chain-of-thought prompting",
                        "explanation": "Classify with reasoning traces.",
                    },
                ],
                "modifiers": [
                    {
                        "name": "no_modifier",
                        "description": "No output modifier",
                        "explanation": "Use direct classification output.",
                    },
                    {
                        "name": "self_consistency",
                        "description": "Self-consistency modifier",
                        "explanation": "Aggregate multiple generations.",
                    },
                ],
            },
            "metadata": {
                "fallback": True,
                "reason": "Optional ai-annotator dependencies are not installed",
            },
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load AI annotation model catalog: {exc}",
        )


@router.get("/ai-annotation/tasks/current")
async def ai_annotation_current_tasks(
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    return await get_current_task_ids_for_analysis(
        user_id, workspace_id, ["ai_annotation", "ai-annotation"]
    )


@router.get("/ai-annotation/tasks/{task_id}/request")
async def ai_annotation_task_request(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task = get_task_manager(user_id).get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    return task.request.model_dump(exclude={"api_key"})


@router.delete("/ai-annotation")
async def clear_ai_annotation(
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)
    current_ids = task_manager.get_current_task_ids("ai_annotation")
    if current_ids:
        task_manager.clear_task(current_ids[0])

    worker_tm = workspace_manager.get_task_manager(user_id)
    if current_ids:
        await worker_tm.clear_task(current_ids[0])

    return {"state": "successful", "message": "AI annotation state cleared"}


@router.post("/ai-annotation")
async def run_ai_annotation(
    request: AiAnnotationRequest,
    current_user: dict = Depends(get_current_user),
):
    """Run AI annotation synchronously for page 1 and persist task metadata."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    ws = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or ws is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    if not request.node_ids:
        raise HTTPException(status_code=400, detail="At least one node ID is required")

    for node_id in request.node_ids:
        if node_id not in request.node_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Missing text column selection for node {node_id}",
            )
        if node_id not in ws.nodes:
            raise HTTPException(status_code=404, detail=f"Node {node_id} not found")

    try:
        _ensure_ai_annotator_import_path()

        analysis_request = AnalysisAiAnnotationRequest(**request.model_dump())
        task_id = str(uuid4())

        task_manager = get_task_manager(user_id)
        task_manager.save_task(
            AnalysisTask(
                task_id=task_id,
                user_id=user_id,
                workspace_id=workspace_id,
                request=analysis_request,
                status=AnalysisStatus.COMPLETED,
                result=GenericAnalysisResult({"ready": True}),
            )
        )
        task_manager.set_current_task("ai_annotation", task_id)

        normalized_request = (
            normalize_saved_request(analysis_request.model_dump()) or {}
        )
        normalized_request.setdefault(
            "page", request.page or DEFAULT_AI_ANNOTATION_PAGE
        )
        normalized_request.setdefault(
            "page_size", request.page_size or DEFAULT_AI_ANNOTATION_PAGE_SIZE
        )
        normalized_request["descending"] = request.descending
        if request.sort_by is not None:
            normalized_request["sort_by"] = request.sort_by

        response = await build_ai_annotation_response(
            user_id,
            workspace_id,
            normalized_request,
        )
        response["metadata"] = {"task_id": task_id}
        return response
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to run AI annotation: {exc}",
        )


@router.get("/ai-annotation/tasks/{task_id}/result")
async def ai_annotation_task_result(
    task_id: str,
    query: AiAnnotationResultQuery = Depends(),
    current_user: dict = Depends(get_current_user),
):
    """Read AI annotation result with optional pagination/sort overrides."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if not task or not task.request:
        raise HTTPException(status_code=404, detail="Task not found")

    _ensure_ai_annotator_import_path()

    request_dict = task.request.model_dump()
    normalized_request = normalize_saved_request(request_dict) or {}
    _apply_result_query_overrides(normalized_request, query)

    normalized_request.setdefault("page", DEFAULT_AI_ANNOTATION_PAGE)
    normalized_request.setdefault("page_size", DEFAULT_AI_ANNOTATION_PAGE_SIZE)

    response = await build_ai_annotation_response(
        user_id, workspace_id, normalized_request
    )
    response["metadata"] = {"task_id": task_id}
    return response


@router.post("/ai-annotation/tasks/{task_id}/result")
async def ai_annotation_task_result_post(
    task_id: str,
    query: AiAnnotationResultQuery,
    current_user: dict = Depends(get_current_user),
):
    """Read AI annotation result using POST body overrides."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    if not workspace_id:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    task_manager = get_task_manager(user_id)
    task = task_manager.get_task(task_id)
    if not task or not task.request:
        return {
            "state": "failed",
            "message": "No analysis found for ai annotation",
            "data": None,
        }

    _ensure_ai_annotator_import_path()

    request_dict = task.request.model_dump()
    normalized_request = normalize_saved_request(request_dict) or {}
    _apply_result_query_overrides(normalized_request, query)

    normalized_request.setdefault("page", DEFAULT_AI_ANNOTATION_PAGE)
    normalized_request.setdefault("page_size", DEFAULT_AI_ANNOTATION_PAGE_SIZE)

    response = await build_ai_annotation_response(
        user_id, workspace_id, normalized_request
    )
    response["metadata"] = {"task_id": task_id}
    return response


@router.post("/nodes/{node_id}/ai-annotation/detach")
async def detach_ai_annotation(
    node_id: str,
    request: AiAnnotationDetachRequest,
    current_user: dict = Depends(get_current_user),
):
    """Submit background task that writes a new node with full-table AI annotations."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    workspace = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or workspace is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = workspace.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    schema = node_data.collect_schema()
    if request.column not in schema:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{request.column}' not found",
        )

    annotation_column = _resolve_annotation_column(
        node_data, request.annotation_column, request.column
    )

    source_df, _row_index_col = _collect_with_temp_row_index(node_data)
    source_rows = source_df.to_dicts()

    artifact_dir, artifact_prefix = _prepare_ai_annotation_artifact_target(
        user_id, workspace_id
    )

    classification_config = {
        "classes": [item.model_dump() for item in request.classes],
        "examples": [item.model_dump() for item in request.examples],
        "technique": request.technique,
        "modifier": request.modifier,
        "provider": request.provider,
        "model": request.model,
        "api_key": request.api_key,
        "endpoint": request.endpoint,
        "temperature": request.temperature,
        "top_p": request.top_p,
        "n_completions": request.n_completions,
        "seed": request.seed,
        "reasoning_effort": request.reasoning_effort,
        "enable_reasoning": request.enable_reasoning,
        "max_reasoning_chars": request.max_reasoning_chars,
    }

    task_manager = workspace_manager.get_task_manager(user_id)
    try:
        task_info = await task_manager.submit_task(
            user_id=user_id,
            workspace_id=workspace_id,
            task_type="ai_annotation_detach",
            task_args={
                "node_rows": source_rows,
                "parent_node_id": node_id,
                "document_column": request.column,
                "annotation_column": annotation_column,
                "classification_config": classification_config,
                "new_node_name": request.new_node_name or f"{node.name}_ai_annotation",
                "artifact_dir": artifact_dir,
                "artifact_prefix": artifact_prefix,
            },
            task_name="Detach AI Annotation",
        )

        return {
            "state": "running",
            "message": "AI annotation detach started",
            "data": None,
            "metadata": {"task_id": task_info.id},
        }
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to submit AI annotation detach task: {exc}",
        )


@router.post("/nodes/{node_id}/ai-annotation/save")
async def save_ai_annotation_edits(
    node_id: str,
    request: AiAnnotationSaveRequest,
    current_user: dict = Depends(get_current_user),
):
    """Persist review-mode annotation edits into the selected node LazyFrame."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    workspace = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or workspace is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = workspace.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    annotation_column = _resolve_annotation_column(
        node_data, request.annotation_column, ""
    )

    if not request.edits:
        return {
            "state": "successful",
            "message": "No edits to save",
            "metadata": {"annotation_column": annotation_column, "updated_rows": 0},
        }

    edit_map: dict[int, list[Any]] = {}
    for edit in request.edits:
        edit_map.setdefault(edit.row_index, []).append(edit)

    source_df, row_index_col = _collect_with_temp_row_index(node_data)
    if annotation_column not in source_df.columns:
        source_df = source_df.with_columns(
            pl.lit([], dtype=ANNOTATION_POLARS_DTYPE).alias(annotation_column)
        )

    rows = source_df.to_dicts()
    updated_rows = 0
    for row in rows:
        row_index = int(row.get(row_index_col, -1))
        edits_for_row = edit_map.get(row_index)
        if not edits_for_row:
            continue

        current_value = row.get(annotation_column)
        for edit in edits_for_row:
            current_value = _merge_annotation(
                current_value,
                provider=edit.provider,
                annotation=edit.annotation,
            )

        row[annotation_column] = current_value
        updated_rows += 1

    updated_df = pl.DataFrame(rows)
    columns_to_drop = set(_internal_row_index_columns(updated_df.columns))
    columns_to_drop.add(row_index_col)
    existing_to_drop = [col for col in columns_to_drop if col in updated_df.columns]
    if existing_to_drop:
        updated_df = updated_df.drop(existing_to_drop)
    updated_df = updated_df.with_columns(
        pl.col(annotation_column).cast(ANNOTATION_POLARS_DTYPE, strict=False)
    )

    try:
        node.data = updated_df.lazy()
        update_workspace(user_id, workspace_id, workspace)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to persist AI annotation edits: {exc}",
        )

    return {
        "state": "successful",
        "message": "AI annotation edits saved",
        "metadata": {
            "annotation_column": annotation_column,
            "updated_rows": updated_rows,
        },
    }


@router.get("/nodes/{node_id}/ai-annotation/providers")
async def list_ai_annotation_providers(
    node_id: str,
    annotation_column: str,
    current_user: dict = Depends(get_current_user),
):
    """Return all unique annotator/provider names for an annotation column (global across node)."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    workspace = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or workspace is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = workspace.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    schema = node_data.collect_schema()
    if annotation_column not in schema:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{annotation_column}' not found",
        )

    try:
        values_df = node_data.select(pl.col(annotation_column)).collect()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load annotation providers: {exc}",
        )

    providers: set[str] = set()
    for cell in values_df.get_column(annotation_column).to_list():
        if not isinstance(cell, list):
            continue
        for item in cell:
            if not isinstance(item, dict):
                continue
            provider_name = str(item.get("provider") or "").strip()
            if provider_name:
                providers.add(provider_name)

    return {
        "state": "successful",
        "message": "AI annotation providers loaded",
        "data": {"providers": sorted(providers)},
        "metadata": {"annotation_column": annotation_column},
    }


@router.get("/nodes/{node_id}/ai-annotation/categories")
async def list_ai_annotation_categories(
    node_id: str,
    annotation_column: str,
    current_user: dict = Depends(get_current_user),
):
    """Return all unique annotation strings for an annotation column (global across node)."""
    user_id = current_user["id"]
    workspace_id = workspace_manager.get_current_workspace_id(user_id)
    workspace = workspace_manager.get_current_workspace(user_id)
    if not workspace_id or workspace is None:
        raise HTTPException(status_code=404, detail="No active workspace selected")

    try:
        node = workspace.nodes[node_id]
    except Exception:
        raise HTTPException(status_code=404, detail="Node not found")

    node_data = getattr(node, "data", None)
    if not isinstance(node_data, pl.LazyFrame):
        raise HTTPException(
            status_code=400, detail="Selected node data must be a LazyFrame"
        )

    schema = node_data.collect_schema()
    if annotation_column not in schema:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{annotation_column}' not found",
        )

    try:
        values_df = node_data.select(pl.col(annotation_column)).collect()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load annotation categories: {exc}",
        )

    categories: set[str] = set()
    for cell in values_df.get_column(annotation_column).to_list():
        if not isinstance(cell, list):
            continue
        for item in cell:
            if not isinstance(item, dict):
                continue
            annotation_value = str(item.get("annotation") or "").strip()
            if annotation_value:
                categories.add(annotation_value)

    return {
        "state": "successful",
        "message": "AI annotation categories loaded",
        "data": {"categories": sorted(categories)},
        "metadata": {"annotation_column": annotation_column},
    }
