"""Process-isolated full-column Annotation Analysis implementation."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import polars as pl

from ..analysis.annotation_examples import (
    AnnotationExample,
    prepare_annotation_examples,
)
from ..domain.workspace import (
    AnnotationAnalysisRequest,
    AnnotationRunAllAnalysisRequest,
)
from ..infrastructure.providers.annotation_ai import (
    AnnotationAiError,
    annotate_all,
)
from ..infrastructure.storage.durable_fs import atomic_output_path
from .input_snapshots import load_snapshot_node
from .utils import process_entrypoint

logger = logging.getLogger(__name__)


@process_entrypoint
def run_annotation_analysis(
    *,
    input_snapshot_dir: str,
    output_dir: str,
    request_payload: dict[str, Any],
    api_key: str | None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict[str, Any]:
    """Classify one immutable Data Block snapshot and publish one private output."""

    try:
        request = AnnotationRunAllAnalysisRequest.model_validate(request_payload)
        source_request = request.source
        source = load_snapshot_node(input_snapshot_dir, str(source_request.node_id))
        schema = source.data.collect_schema()
        if source_request.text_column not in schema:
            raise ValueError("Annotation text column does not exist")
        if source_request.annotation_column not in schema:
            raise ValueError("Annotation column does not exist")
        if progress_callback:
            progress_callback(0.05, "Reading annotation input")
        frame = source.data.collect(engine="streaming")
        text_values = frame.get_column(source_request.text_column).to_list()
        existing_labels = frame.get_column(source_request.annotation_column).to_list()
        target_indices = (
            [
                index
                for index, value in enumerate(existing_labels)
                if value is None or (isinstance(value, str) and not value.strip())
            ]
            if request.processing_mode == "fill_missing"
            else list(range(frame.height))
        )
        texts = [
            str(text_values[index]) if text_values[index] is not None else ""
            for index in target_indices
        ]

        if progress_callback:
            progress_callback(0.1, "Classifying rows")

        def report_batch_progress(
            completed_rows: int,
            total_rows: int,
            failed_batches: int,
        ) -> None:
            if progress_callback is None:
                return
            fraction = (
                0.8 if total_rows == 0 else 0.1 + (0.7 * completed_rows / total_rows)
            )
            suffix = (
                f"; {failed_batches} failed batch{'es' if failed_batches != 1 else ''}"
                if failed_batches
                else ""
            )
            progress_callback(
                fraction,
                f"Processed {completed_rows}/{total_rows} rows{suffix}",
            )

        try:
            outcome = asyncio.run(
                annotate_all(
                    request,
                    api_key,
                    texts,
                    examples=_load_examples(source_request, input_snapshot_dir),
                    progress_callback=report_batch_progress,
                )
            )
        except AnnotationAiError as error:
            logger.warning(
                "Annotation provider failed configuration_id=%s code=%s",
                source_request.provider_configuration_id,
                error.code,
                exc_info=error,
            )
            return {
                "state": "failed",
                "failure": {
                    "code": error.code,
                    "message": error.safe_message,
                },
            }
        if len(outcome.labels) != len(target_indices) or len(
            outcome.failed_rows
        ) != len(target_indices):
            raise ValueError("Annotation provider returned a misaligned result")
        labels = list(existing_labels)
        for index, label, failed in zip(
            target_indices,
            outcome.labels,
            outcome.failed_rows,
            strict=True,
        ):
            if not failed:
                labels[index] = label
        annotation_dtype = frame.schema[source_request.annotation_column]
        annotation_values = pl.Series(
            name=source_request.annotation_column,
            values=labels,
        ).cast(annotation_dtype)
        result = frame.with_columns(annotation_values)

        if progress_callback:
            progress_callback(0.85, "Serializing annotated Data Block")
        relative_path = "annotation-run-all.parquet"
        with atomic_output_path(Path(output_dir) / relative_path) as temporary:
            result.write_parquet(temporary)
        if progress_callback:
            progress_callback(0.95, "Publishing annotated Data Block")
        return {
            "state": "successful",
            "result": {
                "parquet_path": relative_path,
                "output_columns": list(result.columns),
                "record_count": result.height,
                "attempted_count": len(target_indices),
                "failed_batch_count": outcome.failed_batch_count,
                "failed_row_count": outcome.failed_row_count,
            },
            "message": (
                "Annotation completed successfully"
                if outcome.failed_batch_count == 0
                else (
                    "Annotation completed with "
                    f"{outcome.failed_batch_count} failed batches and "
                    f"{outcome.failed_row_count} unannotated rows"
                )
            ),
        }
    except Exception:
        logger.exception("Annotation Analysis failed")
        raise


def _load_examples(
    request: AnnotationAnalysisRequest,
    input_snapshot_dir: str,
) -> list[AnnotationExample]:
    """Load and select the Run All examples once before provider batching.

    Called by ``run_annotation_analysis`` so every initial batch, retry, and
    recursive split receives the same normalized subset from the input snapshot.
    """

    if request.example_node_id is None:
        return []
    assert request.example_text_column is not None
    assert request.example_annotation_column is not None
    example = load_snapshot_node(input_snapshot_dir, str(request.example_node_id))
    frame = example.data.select(
        request.example_text_column,
        request.example_annotation_column,
    ).collect(engine="streaming")
    return prepare_annotation_examples(
        frame.iter_rows(),
        max_examples_per_class=request.max_examples_per_class,
        sampling_method=request.example_sampling_method,
        random_seed=request.example_random_seed,
    )


__all__ = ["run_annotation_analysis"]
