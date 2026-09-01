"""One typed picklable process entrypoint for Analysis execution."""

from __future__ import annotations

from collections.abc import Callable
from multiprocessing.queues import Queue
from typing import Any, assert_never

from .invocations import (
    AnalysisWorkerInput,
    AnnotationInput,
    ConcordanceRunAllInput,
    PreviewReadyInput,
    QuotationRunAllInput,
    ResultDataBlockCreationInput,
    SequentialInput,
    TokenFrequencyInput,
    TopicDataBlockCreationInput,
    TopicModelingInput,
)


def _progress_callback(progress_queue: Queue[Any]) -> Callable[[float, str], None]:
    def report(progress: float, message: str) -> None:
        progress_queue.put({"fraction": progress, "message": message})

    return report


def analysis_process(
    *,
    invocation: AnalysisWorkerInput,
    progress_queue: Queue[Any],
) -> dict[str, Any]:
    """Dispatch one strict invocation without a generic keyword boundary."""

    progress = _progress_callback(progress_queue)
    if isinstance(invocation, PreviewReadyInput):
        return {"ready": True}
    if isinstance(invocation, TokenFrequencyInput):
        from .token_frequency import run_token_frequency_analysis

        return run_token_frequency_analysis(
            node_ids=invocation.node_ids,
            node_columns=invocation.node_columns,
            artifact_dir=invocation.artifact_dir,
            scratch_dir=invocation.scratch_dir,
            input_snapshot_dir=invocation.input_snapshot_dir,
            token_limit=invocation.token_limit,
            node_tokenizer_models=invocation.node_tokenizer_models,
            token_cache_path=invocation.token_cache_path,
            progress_callback=progress,
        )
    if isinstance(invocation, TopicModelingInput):
        from .topic_modeling import run_topic_modeling_analysis

        return run_topic_modeling_analysis(
            node_infos=invocation.node_infos,
            artifact_dir=invocation.artifact_dir,
            input_snapshot_dir=invocation.input_snapshot_dir,
            embedding_cache_path=invocation.embedding_cache_path,
            min_cluster_size=invocation.min_cluster_size,
            random_seed=invocation.random_seed,
            segmentation_method=invocation.segmentation_method,
            max_segment_tokens=invocation.max_segment_tokens,
            sample_fractions=invocation.sample_fractions,
            progress_callback=progress,
        )
    if isinstance(invocation, SequentialInput):
        from .sequential import run_sequential_analysis

        return run_sequential_analysis(
            input_snapshot_dir=invocation.input_snapshot_dir,
            node_id=invocation.node_id,
            artifact_dir=invocation.artifact_dir,
            request_payload=invocation.request_payload,
            progress_callback=progress,
        )
    if isinstance(invocation, TopicDataBlockCreationInput):
        from .topic_modeling import run_topic_modeling_data_block_creation

        return run_topic_modeling_data_block_creation(
            input_snapshot_dir=invocation.input_snapshot_dir,
            output_dir=invocation.output_dir,
            request_payload=invocation.request_payload,
            projection_context_path=invocation.projection_context_path,
            source_projection=invocation.source_projection,
            progress_callback=progress,
        )
    if isinstance(invocation, ResultDataBlockCreationInput):
        from .result_data_block_creation import run_result_data_block_creation

        return run_result_data_block_creation(
            artifact_dir=invocation.artifact_dir,
            request_payload=invocation.request_payload,
            result_paths=invocation.result_paths,
            document_columns=invocation.document_columns,
            progress_callback=progress,
        )
    if isinstance(invocation, ConcordanceRunAllInput):
        from .concordance import run_concordance_run_all

        return run_concordance_run_all(
            artifact_dir=invocation.artifact_dir,
            input_snapshot_dir=invocation.input_snapshot_dir,
            parent_node_id=invocation.parent_node_id,
            document_column=invocation.document_column,
            search_word=invocation.search_word,
            num_left_tokens=invocation.num_left_tokens,
            num_right_tokens=invocation.num_right_tokens,
            regex=invocation.regex,
            whole_word=invocation.whole_word,
            case_sensitive=invocation.case_sensitive,
            ignore_punctuation=invocation.ignore_punctuation,
            search_mode=invocation.search_mode,
            tokenizer_model=invocation.tokenizer_model,
            token_cache_path=invocation.token_cache_path,
            progress_callback=progress,
        )
    if isinstance(invocation, QuotationRunAllInput):
        from .quotation import run_quotation_run_all

        return run_quotation_run_all(
            artifact_dir=invocation.artifact_dir,
            input_snapshot_dir=invocation.input_snapshot_dir,
            parent_node_id=invocation.parent_node_id,
            document_column=invocation.document_column,
            engine=invocation.engine,
            quotation_service_max_batch_size=(
                invocation.quotation_service_max_batch_size
            ),
            quotation_service_timeout=invocation.quotation_service_timeout,
            progress_callback=progress,
        )
    if isinstance(invocation, AnnotationInput):
        from .annotation import run_annotation_analysis

        return run_annotation_analysis(
            input_snapshot_dir=invocation.input_snapshot_dir,
            output_dir=invocation.output_dir,
            request_payload=invocation.request_payload,
            api_key=invocation.api_key,
            progress_callback=progress,
        )
    assert_never(invocation)


__all__ = ["analysis_process"]
