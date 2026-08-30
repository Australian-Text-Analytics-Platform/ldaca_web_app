"""Shared Annotation orchestration independent of provider SDK wire formats."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import cast

from ...analysis.annotation_examples import AnnotationExample
from ...domain.annotation import AnnotationClass
from ...domain.workspace.analysis import (
    AnnotationAnalysisRequest,
    AnnotationRunAllAnalysisRequest,
)
from .annotation_adapter import (
    AnnotationAiError,
    AnnotationContextLimitError,
    AnnotationProviderAdapter,
    AnnotationResponseError,
    InferenceConfig,
)
from .annotation_anthropic import AnthropicAnnotationAdapter
from .annotation_google import GoogleAnnotationAdapter
from .annotation_openai import (
    CustomOpenAICompatibleAnnotationAdapter,
    OpenAIAnnotationAdapter,
)

MAX_CONCURRENCY = 10


@dataclass(frozen=True, slots=True)
class AnnotationAllResult:
    """Row-aligned labels and failure mask plus terminal outcome counts."""

    labels: list[str | None]
    failed_rows: list[bool]
    failed_batch_count: int
    failed_row_count: int


def resolve_provider_adapter(
    provider_id: str,
    base_url: str | None = None,
) -> AnnotationProviderAdapter:
    """Resolve one built-in or trusted Custom concrete adapter."""

    if provider_id == "custom":
        if base_url is None:
            raise ValueError("Custom annotation providers require a base URL")
        return CustomOpenAICompatibleAnnotationAdapter(base_url)
    if base_url is not None:
        raise ValueError("Built-in annotation providers cannot define a base URL")
    adapters: dict[str, AnnotationProviderAdapter] = {
        "openrouter": OpenAIAnnotationAdapter(
            base_url="https://openrouter.ai/api/v1",
        ),
        "openai": OpenAIAnnotationAdapter(),
        "anthropic": AnthropicAnnotationAdapter(),
        "google": GoogleAnnotationAdapter(),
    }
    try:
        return adapters[provider_id]
    except KeyError as exc:
        raise ValueError("Unsupported annotation provider") from exc


def build_annotation_system_prompt(
    instruction: str,
    classes: list[AnnotationClass],
    examples: list[AnnotationExample] | None = None,
) -> str:
    """Assemble the instruction, classes, examples, and strict JSON contract."""

    class_lines = "\n".join(
        f"- {option.name}: {option.description.strip()}"
        if option.description.strip()
        else f"- {option.name}"
        for option in classes
    )
    parts = [
        instruction.strip(),
        "",
        "The batch and JSON response rules below take precedence over any conflicting "
        "response-format wording in the instruction.",
        "",
        "Classify each input text into exactly one of these classes:",
        class_lines,
        "",
        "Rules:",
        "- Use the exact class name shown above for each text.",
        "- If no class applies, use null.",
        '- Respond with ONLY a JSON object of the form {"labels": [...]} containing one',
        "  entry per input text, in the same order. No prose, no markdown.",
    ]
    if examples:
        parts.extend(
            [
                "",
                "Examples (labels are authoritative and may extend the class list):",
                json.dumps(
                    [
                        {"text": example.text, "label": example.label}
                        for example in examples
                    ],
                    ensure_ascii=False,
                ),
            ]
        )
    return "\n".join(parts)


def build_annotation_user_prompt(texts: list[str]) -> str:
    """Render texts as one order-preserving JSON batch."""

    return "\n".join(
        [
            f"Classify these {len(texts)} texts (JSON array, preserve order):",
            json.dumps(texts),
        ]
    )


def align_labels(content: str, count: int, class_names: list[str]) -> list[str | None]:
    """Validate and canonicalize one complete Annotation JSON response."""

    try:
        parsed = json.loads(content)
    except (ValueError, TypeError) as error:
        raise AnnotationResponseError(
            "Annotation response was not valid JSON"
        ) from error
    if not isinstance(parsed, dict) or not isinstance(parsed.get("labels"), list):
        raise AnnotationResponseError(
            'Annotation response must be a JSON object with a "labels" array'
        )
    raw_labels = cast("list[object]", parsed["labels"])
    if len(raw_labels) != count:
        raise AnnotationResponseError(
            "Annotation response must contain exactly one label per input text"
        )
    canonical = {name.strip().casefold(): name for name in class_names}
    result: list[str | None] = []
    for raw in raw_labels:
        if raw is None:
            result.append(None)
            continue
        if not isinstance(raw, str):
            raise AnnotationResponseError(
                "Annotation response labels must be class names or null"
            )
        label = canonical.get(raw.strip().casefold())
        if label is None:
            raise AnnotationResponseError(
                "Annotation response contained an unknown class name"
            )
        result.append(label)
    return result


def _inference_config(request: AnnotationAnalysisRequest) -> InferenceConfig:
    return InferenceConfig(
        temperature=request.temperature,
        reasoning_enabled=request.reasoning_enabled,
        reasoning_effort=request.reasoning_effort,
    )


async def _annotate_batch(
    adapter: AnnotationProviderAdapter,
    model: str,
    api_key: str | None,
    instruction: str,
    classes: list[AnnotationClass],
    texts: list[str],
    config: InferenceConfig,
    max_retries: int,
    examples: list[AnnotationExample] | None = None,
) -> list[str | None]:
    """Classify one batch with shared prompt, retry, and label policy."""

    if not texts:
        return []
    system = build_annotation_system_prompt(instruction, classes, examples)
    user = build_annotation_user_prompt(texts)
    known_labels = [option.name for option in classes]
    if examples is not None:
        known_labels.extend(example.label for example in examples)
    for attempt in range(max_retries + 1):
        try:
            content = await adapter.complete(model, api_key, system, user, config)
            return align_labels(content, len(texts), known_labels)
        except AnnotationContextLimitError:
            raise
        except AnnotationAiError as error:
            if not error.retryable or attempt == max_retries:
                raise
            if not isinstance(error, AnnotationResponseError):
                await asyncio.sleep(2**attempt)
    raise AssertionError("Annotation response retry loop did not return")


async def annotate_preview(
    request: AnnotationAnalysisRequest,
    api_key: str | None,
    texts: list[str],
    examples: list[AnnotationExample] | None = None,
) -> list[str | None]:
    """Classify one fresh Preview page from its immutable request."""

    return await _annotate_batch(
        resolve_provider_adapter(request.provider, request.provider_base_url),
        request.model,
        api_key,
        request.instruction,
        request.classes,
        texts,
        _inference_config(request),
        request.max_retries_per_batch,
        examples,
    )


async def annotate_all(
    request: AnnotationRunAllAnalysisRequest,
    api_key: str | None,
    texts: list[str],
    examples: list[AnnotationExample] | None = None,
    progress_callback: Callable[[int, int, int], None] | None = None,
) -> AnnotationAllResult:
    """Classify a Run All input with bounded concurrency and row order preserved."""

    if not texts:
        return AnnotationAllResult([], [], 0, 0)
    source = request.source
    adapter = resolve_provider_adapter(source.provider, source.provider_base_url)
    config = _inference_config(source)
    size = request.batch_size
    chunks = [texts[start : start + size] for start in range(0, len(texts), size)]
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    completed_rows = 0
    failed_batch_count = 0
    failed_row_count = 0

    def record_terminal_batch(row_count: int, *, failed: bool) -> None:
        nonlocal completed_rows, failed_batch_count, failed_row_count
        completed_rows += row_count
        if failed:
            failed_batch_count += 1
            failed_row_count += row_count
        if progress_callback is not None:
            progress_callback(completed_rows, len(texts), failed_batch_count)

    async def run(chunk: list[str]) -> tuple[list[str | None], list[bool]]:
        try:
            async with semaphore:
                labels = await _annotate_batch(
                    adapter,
                    source.model,
                    api_key,
                    source.instruction,
                    source.classes,
                    chunk,
                    config,
                    source.max_retries_per_batch,
                    examples,
                )
        except AnnotationContextLimitError, AnnotationResponseError:
            if len(chunk) == 1:
                record_terminal_batch(1, failed=True)
                return [None], [True]
            midpoint = len(chunk) // 2
            left, right = await asyncio.gather(
                run(chunk[:midpoint]),
                run(chunk[midpoint:]),
            )
            return [*left[0], *right[0]], [*left[1], *right[1]]
        record_terminal_batch(len(chunk), failed=False)
        return labels, [False] * len(labels)

    batches = await asyncio.gather(*(run(chunk) for chunk in chunks))
    return AnnotationAllResult(
        labels=[label for batch, _failed in batches for label in batch],
        failed_rows=[failed for _batch, failures in batches for failed in failures],
        failed_batch_count=failed_batch_count,
        failed_row_count=failed_row_count,
    )


__all__ = [
    "AnnotationAiError",
    "AnnotationAllResult",
    "AnnotationContextLimitError",
    "AnnotationResponseError",
    "InferenceConfig",
    "align_labels",
    "annotate_all",
    "annotate_preview",
    "build_annotation_system_prompt",
    "build_annotation_user_prompt",
    "resolve_provider_adapter",
]
