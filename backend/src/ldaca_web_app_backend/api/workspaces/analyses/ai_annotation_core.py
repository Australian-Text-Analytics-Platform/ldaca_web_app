"""Core AI annotation computation helpers shared by route handlers."""

from __future__ import annotations

import math
from typing import Any, Optional

import polars as pl
from fastapi import HTTPException

from ....core.docworkspace_data_types import (
    ANNOTATION_POLARS_DTYPE,
    DocWorkspaceDataTypeUtils,
)
from ....core.workspace import workspace_manager

DEFAULT_AI_ANNOTATION_PAGE = 1
DEFAULT_AI_ANNOTATION_PAGE_SIZE = 20
DEFAULT_AI_ANNOTATION_DESCENDING = True

_REQUEST_EXCLUDE_KEYS = {
    "page",
    "page_size",
    "sort_by",
    "descending",
    "pagination",
}


def normalize_saved_request(raw_request: Optional[dict]) -> Optional[dict]:
    """Normalize stored AI annotation request payloads."""
    if not raw_request:
        return None
    if "node_ids" not in raw_request or "node_columns" not in raw_request:
        return None

    normalized_request = dict(raw_request)
    for field in _REQUEST_EXCLUDE_KEYS:
        normalized_request.pop(field, None)

    return {k: v for k, v in normalized_request.items() if v is not None}


def _resolve_annotation_column_name(base_lf: pl.LazyFrame, text_column: str) -> str:
    preferred_name = f"{text_column}_annotation"
    schema = base_lf.collect_schema()

    if preferred_name in schema:
        preferred_type = schema[preferred_name]
        if (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(preferred_type)
            == "annotation"
        ):
            return preferred_name

    for column_name, column_type in schema.items():
        if (
            DocWorkspaceDataTypeUtils.polars_dtype_to_ldaca_dtype(column_type)
            == "annotation"
        ):
            return column_name

    return preferred_name


def _normalize_annotation_list(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, str]] = []
    for item in value:
        if isinstance(item, dict):
            provider = str(item.get("provider") or "").strip()
            annotation = str(item.get("annotation") or "")
            if provider:
                normalized.append({"provider": provider, "annotation": annotation})
    return normalized


def _merge_annotation_entry(
    existing: Any,
    *,
    provider_name: str,
    annotation_value: Optional[str],
) -> list[dict[str, str]]:
    merged = _normalize_annotation_list(existing)
    annotation_text = "" if annotation_value is None else str(annotation_value)

    replaced = False
    for entry in merged:
        if entry.get("provider") == provider_name:
            entry["annotation"] = annotation_text
            replaced = True
            break

    if not replaced:
        merged.append({"provider": provider_name, "annotation": annotation_text})

    return merged


async def _classify_texts(
    texts: list[str],
    request: dict[str, Any],
) -> dict[int, dict[str, Any]]:
    from classifier_fastapi.core.models import LLMConfig
    from classifier_fastapi.core.pipeline import a_batch
    from classifier_fastapi.modifiers import Modifier
    from classifier_fastapi.providers import LLMProvider
    from classifier_fastapi.techniques import Technique
    from classifier_fastapi.techniques.schemas import (
        CoTClass,
        CoTExample,
        CoTUserSchema,
        FewShotClass,
        FewShotExample,
        FewShotUserSchema,
        ZeroShotClass,
        ZeroShotUserSchema,
    )

    provider = LLMProvider(request.get("provider", "openai"))
    model_name = str(request.get("model") or "")
    model_props = provider.properties.get_model_props(model_name)

    api_key = request.get("api_key")
    endpoint = request.get("endpoint")
    if api_key:
        model_props.api_key = api_key
    if endpoint:
        model_props.endpoint = endpoint

    llm_config = LLMConfig(
        temperature=float(request.get("temperature", 1.0)),
        top_p=float(request.get("top_p", 1.0)),
        n_completions=int(request.get("n_completions", 1)),
        seed=request.get("seed", 42),
        reasoning_effort=request.get("reasoning_effort"),
    )

    technique = Technique(request.get("technique", "zero_shot"))
    modifier = Modifier(request.get("modifier", "no_modifier"))

    classes = request.get("classes") or []
    examples = request.get("examples") or []

    if technique == Technique.ZERO_SHOT:
        user_schema = ZeroShotUserSchema(
            classes=[
                ZeroShotClass(name=str(c["name"]), description=str(c["description"]))
                for c in classes
            ]
        )
    elif technique == Technique.FEW_SHOT:
        user_schema = FewShotUserSchema(
            classes=[
                FewShotClass(name=str(c["name"]), description=str(c["description"]))
                for c in classes
            ],
            examples=[
                FewShotExample(
                    query=str(ex["query"]),
                    classification=str(ex["classification"]),
                )
                for ex in examples
            ],
        )
    else:
        user_schema = CoTUserSchema(
            classes=[
                CoTClass(name=str(c["name"]), description=str(c["description"]))
                for c in classes
            ],
            examples=[
                CoTExample(
                    query=str(ex["query"]),
                    classification=str(ex["classification"]),
                )
                for ex in examples
            ],
        )

    batch_results = await a_batch(
        texts=texts,
        model_props=model_props,
        llm_config=llm_config,
        technique=technique,
        user_schema=user_schema,
        modifier=modifier,
        enable_reasoning=bool(request.get("enable_reasoning", False)),
        max_reasoning_chars=int(request.get("max_reasoning_chars", 150)),
    )

    by_idx: dict[int, dict[str, Any]] = {}
    for success in batch_results.successes:
        by_idx[int(success.text_idx)] = {
            "classification": str(success.classification),
            "error": None,
        }

    for fail_idx, fail_error in batch_results.fails:
        by_idx[int(fail_idx)] = {
            "classification": None,
            "error": str(fail_error),
        }

    return by_idx


async def compute_annotation_page(
    base_lf: pl.LazyFrame,
    column: str,
    request: dict[str, Any],
    *,
    page: int,
    page_size: int,
    sort_by: Optional[str],
    descending: bool,
) -> dict[str, Any]:
    """Compute one on-demand AI annotation page for a single node source."""
    working_lf = base_lf
    total_source_rows = working_lf.select(pl.len()).collect().item()

    if page < 1:
        page = DEFAULT_AI_ANNOTATION_PAGE
    if page_size < 1:
        page_size = DEFAULT_AI_ANNOTATION_PAGE_SIZE

    effective_sort_by: Optional[str] = None
    schema = working_lf.collect_schema()
    if sort_by and sort_by in schema:
        working_lf = working_lf.sort(sort_by, descending=descending)
        effective_sort_by = sort_by

    start = (page - 1) * page_size
    page_df = working_lf.slice(start, page_size).collect()

    annotation_column = _resolve_annotation_column_name(working_lf, column)

    texts: list[str] = []
    for value in page_df.get_column(column).to_list():
        texts.append("" if value is None else str(value))

    classification_by_idx = await _classify_texts(texts, request)
    provider_name = str(request.get("model") or request.get("provider") or "unknown")

    has_existing_annotation_column = annotation_column in page_df.columns
    existing_annotation_values = (
        page_df.get_column(annotation_column).to_list()
        if has_existing_annotation_column
        else [None] * page_df.height
    )

    annotation_values: list[list[dict[str, str]]] = []
    for idx, existing in enumerate(existing_annotation_values):
        result_payload = classification_by_idx.get(idx, {})

        if result_payload.get("error") is None:
            annotation_value = result_payload.get("classification")
        else:
            annotation_value = None

        annotation_values.append(
            _merge_annotation_entry(
                existing,
                provider_name=provider_name,
                annotation_value=annotation_value,
            )
        )

    page_df = page_df.with_columns(
        pl.Series(annotation_column, annotation_values).cast(
            ANNOTATION_POLARS_DTYPE,
            strict=False,
        )
    )

    rows = page_df.to_dicts()

    columns = list(page_df.columns)

    total_source_pages = max(1, math.ceil(total_source_rows / page_size))

    metadata_columns = [c for c in columns if c != annotation_column]

    return {
        "data": rows,
        "columns": columns,
        "metadata": {
            "annotation_columns": [annotation_column],
            "metadata_columns": metadata_columns,
            "all_columns": columns,
        },
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_source_rows": total_source_rows,
            "total_source_pages": total_source_pages,
            "result_count": len(rows),
            "has_next": page < total_source_pages,
            "has_prev": page > 1,
        },
        "sorting": {
            "sort_by": effective_sort_by,
            "descending": descending,
        },
    }


def resolve_node_sources(
    user_id: str,
    workspace_id: str,
    request: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    """Resolve workspace nodes into validated AI annotation source metadata."""
    node_ids = request.get("node_ids") or []
    node_columns = request.get("node_columns") or {}

    if workspace_manager.get_current_workspace_id(user_id) != workspace_id:
        if not workspace_manager.set_current_workspace(user_id, workspace_id):
            raise HTTPException(status_code=404, detail="Workspace not found")

    workspace = workspace_manager.get_current_workspace(user_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    node_sources: dict[str, dict[str, Any]] = {}
    label_to_node_map: dict[str, str] = {}

    for node_id in node_ids:
        node = workspace.nodes.get(node_id)
        if node is None:
            continue

        node_label = getattr(node, "name", None) or node_id
        label_to_node_map[node_label] = node_id

        node_data = getattr(node, "data", None)
        if not isinstance(node_data, pl.LazyFrame):
            raise HTTPException(
                status_code=400,
                detail=f"Node {node_id} data must be a LazyFrame",
            )

        column = node_columns.get(node_id)
        if not column:
            continue

        schema = node_data.collect_schema()
        if column not in schema:
            raise HTTPException(
                status_code=400,
                detail=f"Column '{column}' not found in node {node_id}",
            )

        node_sources[node_id] = {
            "lf": node_data,
            "column": column,
            "label": node_label,
        }

    return node_sources, label_to_node_map


async def build_ai_annotation_response(
    user_id: str,
    workspace_id: str,
    request: dict[str, Any],
) -> dict[str, Any]:
    """Build the full AI annotation response from a normalized request."""
    page = int(request.get("page") or DEFAULT_AI_ANNOTATION_PAGE)
    page_size = int(request.get("page_size") or DEFAULT_AI_ANNOTATION_PAGE_SIZE)
    sort_by = request.get("sort_by")
    descending = bool(request.get("descending", DEFAULT_AI_ANNOTATION_DESCENDING))

    node_ids = request.get("node_ids") or []
    node_sources, label_to_node_map = resolve_node_sources(
        user_id, workspace_id, request
    )

    data: dict[str, Any] = {}
    for node_id in node_ids:
        src = node_sources.get(node_id)
        if not src:
            continue

        data[node_id] = await compute_annotation_page(
            src["lf"],
            src["column"],
            request,
            page=page,
            page_size=page_size,
            sort_by=sort_by,
            descending=descending,
        )

    analysis_params = {k: v for k, v in request.items() if k not in {"api_key"}}
    if label_to_node_map:
        analysis_params["label_to_node_map"] = label_to_node_map

    return {
        "state": "successful",
        "message": "AI annotation complete",
        "data": data,
        "analysis_params": analysis_params,
        "combinable": False,
    }
