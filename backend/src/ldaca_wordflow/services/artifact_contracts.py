"""Typed filesystem-artifact projections for persisted Analysis results."""

from __future__ import annotations

from collections.abc import Callable

from pydantic import BaseModel

from ..models.analysis_results import (
    ConcordanceRunAllWorkerResult,
    QuotationRunAllWorkerResult,
    SequentialWorkerResult,
    TokenFrequencyWorkerResult,
    TopicModelingWorkerResult,
)

ArtifactPath = tuple[str | int, ...]
ArtifactProjection = tuple[ArtifactPath, str]
ArtifactProjector = Callable[[BaseModel], list[ArtifactProjection]]


def no_artifacts(_result: BaseModel) -> list[ArtifactProjection]:
    """Declare that an Analysis kind has no filesystem paths in its result."""

    return []


def token_frequency_artifacts(result: BaseModel) -> list[ArtifactProjection]:
    value = TokenFrequencyWorkerResult.model_validate(result)
    projected: list[ArtifactProjection] = [
        (
            ("tables", "nodes", index, "table", "artifact"),
            node.table.artifact,
        )
        for index, node in enumerate(value.tables.nodes)
    ]
    if value.tables.statistics is not None:
        projected.append(
            (
                ("tables", "statistics", "artifact"),
                value.tables.statistics.artifact,
            )
        )
    return projected


def sequential_artifacts(result: BaseModel) -> list[ArtifactProjection]:
    value = SequentialWorkerResult.model_validate(result)
    return [(("table", "artifact"), value.table.artifact)]


def topic_modeling_artifacts(result: BaseModel) -> list[ArtifactProjection]:
    value = TopicModelingWorkerResult.model_validate(result)
    return [
        (
            ("artifacts", "topic_meanings_parquet_path"),
            value.artifacts.topic_meanings_parquet_path,
        ),
        *[
            (
                ("artifacts", "nodes", index, "assignments", "artifact"),
                node.assignments.artifact,
            )
            for index, node in enumerate(value.artifacts.nodes)
        ],
    ]


def concordance_run_all_artifacts(
    result: BaseModel,
) -> list[ArtifactProjection]:
    value = ConcordanceRunAllWorkerResult.model_validate(result)
    return [(("source", "table", "artifact"), value.source.table.artifact)]


def quotation_run_all_artifacts(result: BaseModel) -> list[ArtifactProjection]:
    value = QuotationRunAllWorkerResult.model_validate(result)
    return [(("source", "table", "artifact"), value.source.table.artifact)]


ANALYSIS_ARTIFACT_PROJECTORS: dict[str, ArtifactProjector] = {
    "token_frequency": token_frequency_artifacts,
    "topic_modeling": topic_modeling_artifacts,
    "concordance": no_artifacts,
    "quotation": no_artifacts,
    "sequential": sequential_artifacts,
    "concordance_run_all": concordance_run_all_artifacts,
    "quotation_run_all": quotation_run_all_artifacts,
}


__all__ = [
    "ANALYSIS_ARTIFACT_PROJECTORS",
    "ArtifactProjection",
    "ArtifactProjector",
]
