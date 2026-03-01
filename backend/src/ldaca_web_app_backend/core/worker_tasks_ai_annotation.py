"""AI annotation worker task implementation."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable, Dict, Optional


def _resolve_ai_annotator_root() -> Path:
    backend_root = Path(__file__).resolve().parents[3]
    return backend_root / "ai-annotator"


def run_ai_annotation_task(
    configure_worker_environment,
    user_id: str,
    workspace_id: str,
    node_corpora: Dict[str, list[str]],
    node_display_names: Dict[str, str],
    artifact_dir: str,
    artifact_prefix: str,
    classification_config: Dict[str, Any],
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Execute AI annotation in a worker process and persist parquet artifacts."""
    configure_worker_environment()

    ai_annotator_root = _resolve_ai_annotator_root()
    if str(ai_annotator_root) not in sys.path:
        sys.path.insert(0, str(ai_annotator_root))

    try:
        import polars as pl
        from classifier_fastapi.core.models import LLMConfig
        from classifier_fastapi.core.pipeline import batch
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

        artifact_root = Path(artifact_dir)
        artifact_root.mkdir(parents=True, exist_ok=True)

        if progress_callback:
            progress_callback(0.1, "Validating AI annotation payload...")

        provider = LLMProvider(classification_config.get("provider", "openai"))
        model_name = str(classification_config.get("model") or "")
        model_props = provider.properties.get_model_props(model_name)

        api_key = classification_config.get("api_key")
        endpoint = classification_config.get("endpoint")
        if api_key:
            model_props.api_key = api_key
        if endpoint:
            model_props.endpoint = endpoint

        llm_config = LLMConfig(
            temperature=float(classification_config.get("temperature", 1.0)),
            top_p=float(classification_config.get("top_p", 1.0)),
            n_completions=int(classification_config.get("n_completions", 1)),
            seed=classification_config.get("seed", 42),
            reasoning_effort=classification_config.get("reasoning_effort"),
        )

        technique = Technique(classification_config.get("technique", "zero_shot"))
        modifier = Modifier(classification_config.get("modifier", "no_modifier"))

        classes = classification_config.get("classes") or []
        examples = classification_config.get("examples") or []

        if technique == Technique.ZERO_SHOT:
            user_schema = ZeroShotUserSchema(
                classes=[
                    ZeroShotClass(
                        name=str(c["name"]), description=str(c["description"])
                    )
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

        if progress_callback:
            progress_callback(0.25, "Running model inference...")

        node_artifacts: list[dict[str, Any]] = []
        total_nodes = max(len(node_corpora), 1)

        flattened_texts: list[str] = []
        node_row_to_global_idx: dict[str, list[tuple[int, int, str]]] = {}

        for node_id, docs in node_corpora.items():
            node_rows: list[tuple[int, int, str]] = []
            for row_index, text in enumerate(docs):
                global_index = len(flattened_texts)
                flattened_texts.append(str(text))
                node_rows.append((row_index, global_index, str(text)))
            node_row_to_global_idx[node_id] = node_rows

        global_result_by_idx: dict[int, dict[str, Any]] = {}
        if flattened_texts:
            batch_results = batch(
                texts=flattened_texts,
                model_props=model_props,
                llm_config=llm_config,
                technique=technique,
                user_schema=user_schema,
                modifier=modifier,
                enable_reasoning=bool(
                    classification_config.get("enable_reasoning", False)
                ),
                max_reasoning_chars=int(
                    classification_config.get("max_reasoning_chars", 150)
                ),
            )

            for success in batch_results.successes:
                global_result_by_idx[int(success.text_idx)] = {
                    "classification": str(success.classification),
                    "confidence": success.confidence,
                    "reasoning": success.reasoning,
                    "reasoning_content": success.reasoning_content,
                    "error": None,
                }

            for fail_idx, fail_error in batch_results.fails:
                global_result_by_idx[int(fail_idx)] = {
                    "classification": None,
                    "confidence": None,
                    "reasoning": None,
                    "reasoning_content": None,
                    "error": str(fail_error),
                }

        for idx, (node_id, docs) in enumerate(node_corpora.items()):
            rows = []
            successful = 0
            failed = 0

            for row_index, global_index, text in node_row_to_global_idx.get(
                node_id, []
            ):
                result_payload = global_result_by_idx.get(global_index, {})
                error = result_payload.get("error", "No classification result")
                if error is None:
                    successful += 1
                else:
                    failed += 1

                rows.append({
                    "row_index": int(row_index),
                    "text": str(text),
                    "classification": result_payload.get("classification"),
                    "confidence": result_payload.get("confidence"),
                    "reasoning": result_payload.get("reasoning"),
                    "reasoning_content": result_payload.get("reasoning_content"),
                    "error": error,
                })

            result_path = (
                artifact_root / f"{artifact_prefix}_ai_annotation_{node_id}.parquet"
            )
            dataframe = (
                pl.DataFrame(rows)
                if rows
                else pl.DataFrame({
                    "row_index": [],
                    "text": [],
                    "classification": [],
                    "confidence": [],
                    "reasoning": [],
                    "reasoning_content": [],
                    "error": [],
                })
            )
            dataframe.with_columns([
                pl.col("row_index").cast(pl.Int64),
                pl.col("text").cast(pl.Utf8),
                pl.col("classification").cast(pl.Utf8),
                pl.col("confidence").cast(pl.Float64),
                pl.col("reasoning").cast(pl.Utf8),
                pl.col("reasoning_content").cast(pl.Utf8),
                pl.col("error").cast(pl.Utf8),
            ]).lazy().sink_parquet(result_path)

            node_artifacts.append({
                "node_id": node_id,
                "node_name": node_display_names.get(node_id, node_id),
                "results_parquet_path": str(result_path),
                "total_documents": len(docs),
                "successful": successful,
                "failed": failed,
            })

            if progress_callback:
                progress_callback(
                    0.25 + 0.7 * ((idx + 1) / total_nodes),
                    f"Completed AI annotation for {node_display_names.get(node_id, node_id)}",
                )

        if progress_callback:
            progress_callback(1.0, "AI annotation completed")

        return {
            "state": "successful",
            "message": f"Successfully annotated {len(node_artifacts)} node(s)",
            "artifacts": {
                "version": 1,
                "nodes": node_artifacts,
            },
            "analysis_params": {
                "provider": classification_config.get("provider"),
                "model": classification_config.get("model"),
                "technique": classification_config.get("technique"),
                "modifier": classification_config.get("modifier"),
            },
            "metadata": {
                "node_count": len(node_artifacts),
            },
        }
    except Exception:
        if progress_callback:
            progress_callback(-1.0, "AI annotation failed")
        raise


def run_ai_annotation_detach_task(
    configure_worker_environment,
    node_rows: list[dict[str, Any]],
    parent_node_id: str,
    document_column: str,
    annotation_column: str,
    classification_config: Dict[str, Any],
    new_node_name: str,
    artifact_dir: str,
    artifact_prefix: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> Dict[str, Any]:
    """Annotate an entire node corpus and materialize merged results as parquet."""
    configure_worker_environment()

    ai_annotator_root = _resolve_ai_annotator_root()
    if str(ai_annotator_root) not in sys.path:
        sys.path.insert(0, str(ai_annotator_root))

    try:
        import polars as pl
        from classifier_fastapi.core.models import LLMConfig
        from classifier_fastapi.core.pipeline import batch
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

        artifact_root = Path(artifact_dir)
        artifact_root.mkdir(parents=True, exist_ok=True)

        if progress_callback:
            progress_callback(0.1, "Preparing AI annotation detach payload...")

        provider = LLMProvider(classification_config.get("provider", "openai"))
        model_name = str(classification_config.get("model") or "")
        model_props = provider.properties.get_model_props(model_name)

        api_key = classification_config.get("api_key")
        endpoint = classification_config.get("endpoint")
        if api_key:
            model_props.api_key = api_key
        if endpoint:
            model_props.endpoint = endpoint

        llm_config = LLMConfig(
            temperature=float(classification_config.get("temperature", 1.0)),
            top_p=float(classification_config.get("top_p", 1.0)),
            n_completions=int(classification_config.get("n_completions", 1)),
            seed=classification_config.get("seed", 42),
            reasoning_effort=classification_config.get("reasoning_effort"),
        )

        technique = Technique(classification_config.get("technique", "zero_shot"))
        modifier = Modifier(classification_config.get("modifier", "no_modifier"))

        classes = classification_config.get("classes") or []
        examples = classification_config.get("examples") or []

        if technique == Technique.ZERO_SHOT:
            user_schema = ZeroShotUserSchema(
                classes=[
                    ZeroShotClass(
                        name=str(c["name"]), description=str(c["description"])
                    )
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

        provider_name = str(
            classification_config.get("model")
            or classification_config.get("provider")
            or "unknown"
        )

        texts = [
            "" if row.get(document_column) is None else str(row.get(document_column))
            for row in node_rows
        ]

        if progress_callback:
            progress_callback(0.3, "Running model inference for detached annotation...")

        result_by_idx: dict[int, str | None] = {}
        if texts:
            batch_results = batch(
                texts=texts,
                model_props=model_props,
                llm_config=llm_config,
                technique=technique,
                user_schema=user_schema,
                modifier=modifier,
                enable_reasoning=bool(
                    classification_config.get("enable_reasoning", False)
                ),
                max_reasoning_chars=int(
                    classification_config.get("max_reasoning_chars", 150)
                ),
            )

            for success in batch_results.successes:
                result_by_idx[int(success.text_idx)] = str(success.classification)
            for fail_idx, _fail_error in batch_results.fails:
                result_by_idx[int(fail_idx)] = None

        def _normalize_existing(value: Any) -> list[dict[str, str]]:
            if not isinstance(value, list):
                return []
            items: list[dict[str, str]] = []
            for item in value:
                if not isinstance(item, dict):
                    continue
                provider_val = str(item.get("provider") or "").strip()
                if not provider_val:
                    continue
                items.append({
                    "provider": provider_val,
                    "annotation": str(item.get("annotation") or ""),
                })
            return items

        def _merge_provider(
            existing: Any,
            provider_value: str,
            annotation_value: str | None,
        ) -> list[dict[str, str]]:
            merged = _normalize_existing(existing)
            resolved_annotation = (
                "" if annotation_value is None else str(annotation_value)
            )

            replaced = False
            for entry in merged:
                if entry.get("provider") == provider_value:
                    entry["annotation"] = resolved_annotation
                    replaced = True
                    break
            if not replaced:
                merged.append({
                    "provider": provider_value,
                    "annotation": resolved_annotation,
                })
            return merged

        updated_rows: list[dict[str, Any]] = []
        for idx, row in enumerate(node_rows):
            row_dict = dict(row)
            row_dict[annotation_column] = _merge_provider(
                row_dict.get(annotation_column),
                provider_name,
                result_by_idx.get(idx),
            )
            updated_rows.append(row_dict)

        result_df = pl.DataFrame(updated_rows) if updated_rows else pl.DataFrame({})

        if annotation_column in result_df.columns:
            annotation_dtype = pl.List(
                pl.Struct([
                    pl.Field("provider", pl.Utf8),
                    pl.Field("annotation", pl.Utf8),
                ])
            )
            result_df = result_df.with_columns(
                pl.col(annotation_column).cast(annotation_dtype, strict=False)
            )

        result_path = artifact_root / f"{artifact_prefix}_ai_annotation_detach.parquet"
        result_df.write_parquet(result_path)

        if progress_callback:
            progress_callback(1.0, "AI annotation detach completed")

        return {
            "state": "successful",
            "message": "AI annotation detach completed",
            "result": {
                "parquet_path": str(result_path),
                "new_node_name": new_node_name,
                "parent_node_id": parent_node_id,
                "document_column": document_column,
            },
            "metadata": {
                "row_count": len(updated_rows),
                "annotation_column": annotation_column,
            },
        }
    except Exception:
        if progress_callback:
            progress_callback(-1.0, "AI annotation detach failed")
        raise
