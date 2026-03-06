"""Core helpers for AI annotation using the OpenAI chat completions API."""

from __future__ import annotations

import logging
import os
from typing import Any

from openai import AsyncOpenAI
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ClassificationResult(BaseModel):
    """Structured output schema: one classification per input text, in order."""

    classifications: list[str]


def _build_system_prompt(
    classes: list[dict[str, str]],
    examples: list[dict[str, str]] | None = None,
) -> str:
    class_descriptions = "\n".join(
        f"- {c['name']}: {c['description']}" for c in classes
    )
    class_names = ", ".join(c["name"] for c in classes)

    base = (
        "You are a text classification assistant. "
        "Classify each piece of text into exactly one of the following categories.\n\n"
        f"Categories:\n{class_descriptions}\n\n"
    )

    if examples:
        example_lines = "\n".join(
            f'Text: "{ex["query"]}"\nClassification: {ex["classification"]}'
            for ex in examples
        )
        base += f"Examples:\n{example_lines}\n\n"

    base += (
        "You will receive one or more texts, each on its own numbered line "
        "(e.g. '1: some text'). "
        "Return the classification for each text in the same order as a list. "
        f"Valid categories are: {class_names}."
    )

    return base


def _normalize_classifications(
    raw_list: list[str],
    count: int,
    class_names: list[str],
) -> list[str | None]:
    """Normalize and pad/trim a list of classifications to *count* entries."""
    lower_map = {name.lower(): name for name in class_names}
    results: list[str | None] = []

    for i in range(count):
        if i < len(raw_list):
            value = raw_list[i].strip()
            if value.lower() in lower_map:
                results.append(lower_map[value.lower()])
            else:
                matched = False
                for name in class_names:
                    if name.lower() in value.lower():
                        results.append(name)
                        matched = True
                        break
                if not matched:
                    results.append(value)
        else:
            results.append(None)

    return results


async def classify_texts(
    texts: list[str],
    classes: list[dict[str, str]],
    examples: list[dict[str, str]] | None = None,
    model: str = "gpt-4o-mini",
    api_key: str | None = None,
    base_url: str | None = None,
    temperature: float = 1.0,
    top_p: float = 1.0,
    seed: int | None = 42,
    batch_size: int = 100,
    text_column_name: str = "text",
) -> list[dict[str, Any]]:
    """Classify a list of texts using the OpenAI chat completions API.

    Uses structured outputs so the model returns ``ClassificationResult`` —
    a simple ``list[str]`` of categories in the same order as the input texts.
    """
    resolved_api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
    client = AsyncOpenAI(
        api_key=resolved_api_key or "no-key",
        base_url=base_url or None,
    )

    system_prompt = _build_system_prompt(classes, examples)
    class_names = [c["name"] for c in classes]

    all_results: list[dict[str, Any]] = []

    for batch_start in range(0, len(texts), batch_size):
        batch_texts = texts[batch_start : batch_start + batch_size]
        batch_count = len(batch_texts)

        numbered_lines = "\n".join(f"{i + 1}: {t}" for i, t in enumerate(batch_texts))

        try:
            response = await client.chat.completions.parse(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": numbered_lines},
                ],
                response_format=ClassificationResult,
                temperature=temperature,
                top_p=top_p,
                seed=seed,
            )

            message = response.choices[0].message
            if message.refusal:
                raise ValueError(f"Model refused structured output: {message.refusal}")

            parsed = message.parsed
            if parsed is None:
                raise ValueError("Structured output parsing returned no parsed result")

            raw_list = parsed.classifications

            classifications = _normalize_classifications(
                raw_list, batch_count, class_names
            )

            for i, (text, cls) in enumerate(zip(batch_texts, classifications)):
                all_results.append({
                    "row_index": batch_start + i,
                    text_column_name: text,
                    "classification": cls,
                    "error": None if cls is not None else "No classification returned",
                })
        except Exception as exc:
            logger.warning(
                "Batch classification failed for rows %d-%d: %s",
                batch_start,
                batch_start + batch_count - 1,
                exc,
            )
            for i, text in enumerate(batch_texts):
                all_results.append({
                    "row_index": batch_start + i,
                    text_column_name: text,
                    "classification": None,
                    "error": str(exc),
                })

    return all_results


async def list_models(
    base_url: str | None = None,
    api_key: str | None = None,
) -> list[dict[str, str]]:
    """List available models from an OpenAI-compatible endpoint."""
    resolved_api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
    client = AsyncOpenAI(
        api_key=resolved_api_key or "no-key",
        base_url=base_url or None,
    )

    try:
        models_page = await client.models.list()
        return [{"id": m.id, "name": m.id} for m in models_page.data]
    except Exception as exc:
        logger.warning("Failed to list models: %s", exc)
        return []
