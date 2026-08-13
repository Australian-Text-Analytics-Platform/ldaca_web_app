"""Picklable process entrypoints for canonical Analysis execution.

Heavy analysis imports occur inside each child entrypoint. Progress callbacks
forward raw reports to the runtime-owned queue so the owning service performs
the one strict validation step.
"""

from __future__ import annotations

from collections.abc import Callable
from multiprocessing.queues import Queue
from typing import Any


def _progress_callback(progress_queue: Queue[Any]) -> Callable[[float, str], None]:
    def report(progress: float, message: str) -> None:
        progress_queue.put({"fraction": progress, "message": message})

    return report


def preview_ready_process(
    *, progress_queue: Queue[Any], **_kwargs: Any
) -> dict[str, Any]:
    """Finish a root Preview after its immutable input snapshot is captured."""

    return {"ready": True}


def token_frequency_process(
    *, progress_queue: Queue[Any], **kwargs: Any
) -> dict[str, Any]:
    from .token_frequency import run_token_frequency_analysis

    return run_token_frequency_analysis(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )


def topic_modeling_process(
    *, progress_queue: Queue[Any], **kwargs: Any
) -> dict[str, Any]:
    from .topic_modeling import run_topic_modeling_analysis

    return run_topic_modeling_analysis(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )


def topic_modeling_data_block_creation_process(
    *, progress_queue: Queue[Any], **kwargs: Any
) -> dict[str, Any]:
    from .topic_modeling import run_topic_modeling_data_block_creation

    return run_topic_modeling_data_block_creation(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )



def sequential_process(*, progress_queue: Queue[Any], **kwargs: Any) -> dict[str, Any]:
    from .sequential import run_sequential_analysis

    return run_sequential_analysis(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )


def annotation_process(*, progress_queue: Queue[Any], **kwargs: Any) -> dict[str, Any]:
    from .annotation import run_annotation_analysis

    return run_annotation_analysis(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )


def concordance_run_all_process(
    *, progress_queue: Queue[Any], **kwargs: Any
) -> dict[str, Any]:
    from .concordance import run_concordance_run_all

    return run_concordance_run_all(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )


def quotation_run_all_process(
    *, progress_queue: Queue[Any], **kwargs: Any
) -> dict[str, Any]:
    from .quotation import run_quotation_run_all

    return run_quotation_run_all(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )


def result_data_block_creation_process(
    *, progress_queue: Queue[Any], **kwargs: Any
) -> dict[str, Any]:
    from .result_data_block_creation import run_result_data_block_creation

    return run_result_data_block_creation(
        progress_callback=_progress_callback(progress_queue),
        **kwargs,
    )
