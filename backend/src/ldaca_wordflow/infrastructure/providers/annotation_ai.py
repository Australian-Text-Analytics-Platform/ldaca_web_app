"""External AI provider adapter for annotation inference.

Used by Analysis result queries for fresh Preview pages and by Annotation
Run All for full-column annotation. This module is the single place that knows
how to speak each supported provider's wire format.

Why it exists:
- Centralising calls here bounds timeouts/retries, fans batches out with bounded
  concurrency, and keeps prompt-building and label coercion identical across
  providers.

Flow (per call):
- Resolve a built-in provider id or the immutable, validated API root captured
  for a trusted user's Custom OpenAI-compatible configuration.
- Build a shared system prompt (instruction + labelled class list + strict JSON
  contract) and a user prompt (the texts as a JSON array, order preserved).
- Dispatch one request per batch through the provider's *native* async SDK
  (``AsyncOpenAI`` for openai/openrouter, ``AsyncAnthropic`` for anthropic,
  ``google-genai`` aio for google).
- Validate the JSON reply and canonicalise every returned label to a known class
  name (case-insensitive) or ``None``. A complete response must contain exactly
  one label per input text so callers can map results back positionally.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, cast

from ...analysis.annotation_examples import AnnotationExample
from ...domain.annotation import (
    ANNOTATION_PROVIDER_SAFE_MESSAGES,
    AnnotationClass,
    AnnotationProviderFailureCode,
)
from ...domain.workspace.analysis import (
    AnnotationAnalysisRequest,
    AnnotationRunAllAnalysisRequest,
)

# Per-request network timeout. Chosen well below the provider SDKs' 10-minute
# default so a slow or rate-limited provider has a bounded wait.
REQUEST_TIMEOUT_SECONDS = 90.0
# Model discovery is not part of an Analysis request, so it keeps one bounded
# transient retry independently of the per-batch Annotation setting.
MODEL_DISCOVERY_MAX_RETRIES = 1
# Ceiling on batches in flight at once for Run All. Bounded so a large table
# fans out concurrently (not one batch after another) without hammering the
# provider into rate limits.
MAX_CONCURRENCY = 10

_CONTEXT_LIMIT_ERROR_MARKERS = (
    "context_length_exceeded",
    "maximum context length",
    "context window",
    "prompt is too long",
    "input token count",
    "too many input tokens",
    "exceeds the maximum number of tokens",
)

AnnotationChatStyle = Literal["openai", "anthropic", "google"]
class AnnotationAiError(Exception):
    """One classified provider failure with private and public representations.

    Provider adapters retain the raw SDK description in ``Exception.args`` for
    correlated logs. HTTP and Analysis boundaries consume only ``code`` and
    ``safe_message``, so SDK bodies, URLs, and credentials never become public.
    """

    def __init__(
        self,
        message: str,
        *,
        code: AnnotationProviderFailureCode = "annotation_provider_failed",
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.safe_message = ANNOTATION_PROVIDER_SAFE_MESSAGES[code]
        self.retryable = retryable


class AnnotationContextLimitError(AnnotationAiError):
    """A provider rejected one prompt because it exceeded the model context."""

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            code="annotation_provider_context_limit",
            retryable=False,
        )


class AnnotationResponseError(AnnotationAiError):
    """A provider returned an incomplete or invalid successful response."""

    def __init__(self, message: str) -> None:
        super().__init__(
            message,
            code="annotation_provider_invalid_response",
            retryable=True,
        )


def _completion_error(error: Exception, fallback: str) -> AnnotationAiError:
    """Normalize common SDK status and transport shapes into stable categories.

    Called by every completion adapter and model discovery. Classification uses
    status metadata first and conservative exception-type markers for transport
    failures; unknown errors use the non-retryable safe fallback.
    """

    message = str(error) or fallback
    details = " ".join(
        (
            message,
            str(getattr(error, "code", "")),
            str(getattr(error, "body", "")),
        )
    ).casefold()
    if any(marker in details for marker in _CONTEXT_LIMIT_ERROR_MARKERS):
        return AnnotationContextLimitError(message)
    status = getattr(error, "status_code", None)
    if not isinstance(status, int):
        response = getattr(error, "response", None)
        status = getattr(response, "status_code", None)
    if not isinstance(status, int):
        candidate = getattr(error, "code", None)
        status = candidate if isinstance(candidate, int) else None
    if status == 401:
        code: AnnotationProviderFailureCode = (
            "annotation_provider_authentication_failed"
        )
    elif status == 403:
        code = "annotation_provider_access_denied"
    elif status == 429:
        code = "annotation_provider_rate_limited"
    elif status in {408} or (isinstance(status, int) and status >= 500):
        code = "annotation_provider_unavailable"
    elif isinstance(status, int) and 400 <= status < 500:
        code = "annotation_provider_request_rejected"
    else:
        error_name = type(error).__name__.casefold()
        if isinstance(error, (ConnectionError, TimeoutError)) or any(
            marker in error_name
            for marker in ("connection", "connect", "network", "timeout")
        ):
            code = "annotation_provider_unavailable"
        else:
            code = "annotation_provider_failed"
    return AnnotationAiError(
        message,
        code=code,
        retryable=code
        in {
            "annotation_provider_rate_limited",
            "annotation_provider_unavailable",
        },
    )


@dataclass(frozen=True)
class ProviderWire:
    """How one provider is addressed on the wire for the annotation call.

    Used by:
    - ``resolve_provider_wire`` (produces it) and the ``_complete_*`` /
      ``list_models`` dispatchers (consume it) because those are the only places
      that need to branch on chat format, base URL, and JSON-mode support.
    """

    chat_style: AnnotationChatStyle
    # OpenAI-SDK ``base_url``: OpenRouter points at its ``/api/v1``; OpenAI uses
    # the SDK default (None).
    # Ignored by the anthropic/google styles, whose SDKs target their own hosts.
    base_url: str | None
    # True when the provider honours OpenAI's ``response_format=json_object`` for
    # guaranteed-valid JSON. Only the hosted OpenAI-style providers set it.
    supports_json_response_format: bool


# Built-in provider catalogue. Custom OpenAI-compatible providers carry their
# validated API-root snapshot separately.
PROVIDER_WIRES: dict[str, ProviderWire] = {
    "openrouter": ProviderWire("openai", "https://openrouter.ai/api/v1", True),
    "openai": ProviderWire("openai", None, True),
    "anthropic": ProviderWire("anthropic", None, False),
    "google": ProviderWire("google", None, False),
}


def resolve_provider_wire(
    provider_id: str,
    base_url: str | None = None,
) -> ProviderWire:
    """Resolve one built-in or trusted Custom provider wire configuration."""

    if provider_id == "custom":
        if base_url is None:
            raise ValueError("Custom annotation providers require a base URL")
        return ProviderWire("openai", base_url, False)
    if base_url is not None:
        raise ValueError("Built-in annotation providers cannot define a base URL")

    try:
        return PROVIDER_WIRES[provider_id]
    except KeyError as exc:
        raise ValueError("Unsupported annotation provider") from exc


# Extended-thinking token budget per effort level for the providers whose SDKs
# take a raw budget (Anthropic, Google). OpenAI-style providers instead accept
# the effort string directly, so they ignore this table.
_REASONING_BUDGET_TOKENS: dict[str, int] = {"low": 1024, "medium": 4096, "high": 12000}
# Head-room added above a thinking budget for the visible answer, since a
# provider's max output tokens must exceed the tokens it may spend thinking.
ANSWER_TOKEN_HEADROOM = 4096


@dataclass(frozen=True)
class InferenceConfig:
    """Provider-agnostic sampling and reasoning values for one request."""

    temperature: float
    reasoning_enabled: bool
    reasoning_effort: Literal["low", "medium", "high"]


def _reasoning_budget_tokens(effort: str) -> int:
    """Map a validated reasoning effort to a provider thinking-token budget."""

    return _REASONING_BUDGET_TOKENS[effort]


def _max_completion_tokens(config: InferenceConfig) -> int:
    """Bound answer generation while leaving room for requested reasoning."""

    if not config.reasoning_enabled:
        return ANSWER_TOKEN_HEADROOM
    return _reasoning_budget_tokens(config.reasoning_effort) + ANSWER_TOKEN_HEADROOM


@dataclass(frozen=True)
class AnnotationAllResult:
    """Row-aligned labels and failure mask plus terminal outcome counts."""

    labels: list[str | None]
    failed_rows: list[bool]
    failed_batch_count: int
    failed_row_count: int


def build_annotation_system_prompt(
    instruction: str,
    classes: list[AnnotationClass],
    examples: list[AnnotationExample] | None = None,
) -> str:
    """Assemble the system message: instruction + labelled classes + JSON contract.

    The instruction leads, each class is listed with its optional description,
    and a strict ``{"labels": [...]}`` contract keeps replies machine-parseable.
    """
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
    """Render the page texts as a JSON array so special characters stay unambiguous.

    The count is stated up front and input order is preserved so the model's
    positional ``labels`` array lines up with source rows.
    """
    return "\n".join(
        [
            f"Classify these {len(texts)} texts (JSON array, preserve order):",
            json.dumps(texts),
        ]
    )


def align_labels(content: str, count: int, class_names: list[str]) -> list[str | None]:
    """Validate and canonicalise one complete Annotation JSON response."""

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


async def _complete_openai(
    wire: ProviderWire,
    model: str,
    api_key: str | None,
    system: str,
    user: str,
    config: InferenceConfig,
) -> str:
    """Run the completion through the native OpenAI SDK (also OpenRouter/custom).

    Called by ``_annotate_batch`` for the ``openai`` chat style. The three
    OpenAI-compatible providers differ only by ``base_url``; a placeholder key is
    used for keyless endpoints (the SDK rejects an empty string). JSON mode is
    requested when the provider supports it. Any SDK error is wrapped in
    ``AnnotationAiError`` so the router can return a single 502 shape.

    Reasoning: OpenAI's reasoning models constrain temperature (many accept only
    their default), so when the user enables reasoning we send the native
    ``reasoning_effort`` and let the model default its own temperature; otherwise
    we honour the chosen temperature and send no reasoning param.
    """
    from openai import AsyncOpenAI, Omit, omit
    from openai.types import ReasoningEffort
    from openai.types.chat import ChatCompletionMessageParam

    client = AsyncOpenAI(
        api_key=api_key or "no-key-required",
        base_url=wire.base_url,
        timeout=REQUEST_TIMEOUT_SECONDS,
        max_retries=0,
    )
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    reasoning_effort: ReasoningEffort | Omit = (
        cast(ReasoningEffort, config.reasoning_effort)
        if config.reasoning_enabled
        else omit
    )
    temperature: float | Omit = omit if config.reasoning_enabled else config.temperature
    try:
        # Two call shapes (rather than a splat) keep JSON mode strongly typed:
        # only the hosted OpenAI-style providers accept response_format.
        #
        # ``stream=False`` is passed explicitly (not just left to default) because
        # some OpenAI-compatible servers — notably Apple's on-device ``fm serve`` —
        # stream a Server-Sent-Events body whenever the request omits ``stream``.
        # The SDK's non-streaming path then tries to JSON-decode that SSE text and
        # yields a bare ``str`` (``'str' object has no attribute 'choices'``).
        # Sending the literal ``False`` forces a single JSON completion for every
        # provider and is a no-op for the hosted ones that already default to it.
        if wire.supports_json_response_format:
            completion = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                reasoning_effort=reasoning_effort,
                max_completion_tokens=_max_completion_tokens(config),
                response_format={"type": "json_object"},
                stream=False,
            )
        else:
            completion = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                reasoning_effort=reasoning_effort,
                max_completion_tokens=_max_completion_tokens(config),
                stream=False,
            )
    except Exception as error:  # noqa: BLE001 - normalise every SDK failure shape
        raise _completion_error(error, "OpenAI request failed") from error
    choice = completion.choices[0]
    if choice.finish_reason == "length":
        raise AnnotationResponseError("Annotation response reached its output limit")
    return choice.message.content or ""


async def _complete_anthropic(
    model: str,
    api_key: str,
    system: str,
    user: str,
    config: InferenceConfig,
) -> str:
    """Run the completion through the native Anthropic SDK.

    Called by ``_annotate_batch`` for the ``anthropic`` chat style. The system
    prompt is passed as Anthropic's top-level ``system`` field; text blocks in the
    reply are concatenated into the raw JSON payload. Errors are wrapped in
    ``AnnotationAiError``.

    Reasoning: when enabled we turn on extended thinking with a token budget mapped
    from the effort level, raise ``max_tokens`` above that budget so there is room
    for the answer, and omit temperature (Anthropic requires the default
    temperature while thinking is on). When disabled we honour the temperature and
    send no thinking config.
    """
    from anthropic import AsyncAnthropic, Omit, omit
    from anthropic.types import TextBlock, ThinkingConfigParam

    client = AsyncAnthropic(
        api_key=api_key,
        timeout=REQUEST_TIMEOUT_SECONDS,
        max_retries=0,
    )
    max_tokens = 4096
    thinking: ThinkingConfigParam | Omit = omit
    temperature: float | Omit = config.temperature
    if config.reasoning_enabled:
        budget = _reasoning_budget_tokens(config.reasoning_effort)
        max_tokens = budget + ANSWER_TOKEN_HEADROOM
        thinking = {"type": "enabled", "budget_tokens": budget}
        temperature = omit
    try:
        message = await client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            temperature=temperature,
            thinking=thinking,
        )
    except Exception as error:  # noqa: BLE001 - normalise every SDK failure shape
        raise _completion_error(error, "Anthropic request failed") from error
    return "".join(
        block.text for block in message.content if isinstance(block, TextBlock)
    )


async def _complete_google(
    model: str,
    api_key: str,
    system: str,
    user: str,
    config: InferenceConfig,
) -> str:
    """Run the completion through the native Google GenAI SDK (async client).

    Called by ``_annotate_batch`` for the ``google`` chat style. The system prompt
    becomes ``system_instruction`` and ``response_mime_type`` asks Gemini for raw
    JSON. Errors are wrapped in ``AnnotationAiError``.

    Reasoning: Gemini allows temperature alongside thinking, so temperature is
    always sent; a ``ThinkingConfig`` with the effort's token budget is attached
    only when reasoning is enabled (otherwise the provider default applies).
    """
    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(
            timeout=int(REQUEST_TIMEOUT_SECONDS * 1000),
            retry_options=types.HttpRetryOptions(attempts=1),
        ),
    )
    thinking_config = (
        types.ThinkingConfig(
            thinking_budget=_reasoning_budget_tokens(config.reasoning_effort)
        )
        if config.reasoning_enabled
        else None
    )
    try:
        response = await client.aio.models.generate_content(
            model=model,
            contents=user,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=config.temperature,
                max_output_tokens=_max_completion_tokens(config),
                response_mime_type="application/json",
                thinking_config=thinking_config,
            ),
        )
    except Exception as error:  # noqa: BLE001 - normalise every SDK failure shape
        raise _completion_error(error, "Google request failed") from error
    return response.text or ""


def _inference_config(request: AnnotationAnalysisRequest) -> InferenceConfig:
    return InferenceConfig(
        temperature=request.temperature,
        reasoning_enabled=request.reasoning_enabled,
        reasoning_effort=request.reasoning_effort,
    )


async def _annotate_batch(
    wire: ProviderWire,
    model: str,
    api_key: str | None,
    instruction: str,
    classes: list[AnnotationClass],
    texts: list[str],
    config: InferenceConfig,
    max_retries: int,
    examples: list[AnnotationExample] | None = None,
) -> list[str | None]:
    """Classify one batch of texts in a single provider request.

    Build the shared prompt, dispatch to the provider adapter, and coerce the
    response to one known-label-or-null value per input row.
    """
    if not texts:
        return []
    if wire.chat_style == "anthropic" and api_key is None:
        raise AnnotationAiError(
            "Anthropic requires an API key",
            code="annotation_provider_authentication_failed",
        )
    if wire.chat_style == "google" and api_key is None:
        raise AnnotationAiError(
            "Google requires an API key",
            code="annotation_provider_authentication_failed",
        )
    system = build_annotation_system_prompt(instruction, classes, examples)
    user = build_annotation_user_prompt(texts)
    known_labels = [option.name for option in classes]
    if examples is not None:
        known_labels.extend(example.label for example in examples)
    for attempt in range(max_retries + 1):
        try:
            if wire.chat_style == "anthropic":
                content = await _complete_anthropic(
                    model, cast("str", api_key), system, user, config
                )
            elif wire.chat_style == "google":
                content = await _complete_google(
                    model, cast("str", api_key), system, user, config
                )
            else:
                content = await _complete_openai(
                    wire, model, api_key, system, user, config
                )
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
        resolve_provider_wire(request.provider, request.provider_base_url),
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
    """Classify a complete Run All input with row order preserved.

    Context-limit and invalid-response failures recursively split only the
    affected chunk until an irreducible row is marked failed. Every provider-wide
    failure propagates so the worker can fail without publishing partial output.
    """
    if not texts:
        return AnnotationAllResult([], [], 0, 0)
    source = request.source
    wire = resolve_provider_wire(source.provider, source.provider_base_url)
    config = _inference_config(source)
    size = request.batch_size
    chunks = [texts[start : start + size] for start in range(0, len(texts), size)]
    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    completed_rows = 0
    failed_batch_count = 0
    failed_row_count = 0

    def record_terminal_batch(row_count: int, *, failed: bool) -> None:
        nonlocal completed_rows
        nonlocal failed_batch_count
        nonlocal failed_row_count
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
                    wire,
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


def _strip_google_model_prefix(name: str) -> str:
    """Drop Gemini's ``models/`` namespace so the id matches the generate call.

    Model discovery returns this namespace while generation accepts the bare id.
    """
    prefix = "models/"
    return name[len(prefix) :] if name.startswith(prefix) else name


async def list_models(wire: ProviderWire, api_key: str | None) -> list[str]:
    """List a provider's available model ids through its native SDK.

    Used by the provider-model resource route. SDK failures are normalized to
    ``AnnotationAiError`` and model ids are de-duplicated and sorted.
    """
    ids: set[str] = set()
    try:
        if wire.chat_style == "anthropic":
            if api_key is None:
                raise AnnotationAiError(
                    "Anthropic requires an API key",
                    code="annotation_provider_authentication_failed",
                )
            from anthropic import AsyncAnthropic

            anthropic_client = AsyncAnthropic(
                api_key=api_key,
                timeout=REQUEST_TIMEOUT_SECONDS,
                max_retries=MODEL_DISCOVERY_MAX_RETRIES,
            )
            async for model in anthropic_client.models.list():
                if isinstance(model.id, str) and model.id:
                    ids.add(model.id)
        elif wire.chat_style == "google":
            if api_key is None:
                raise AnnotationAiError(
                    "Google requires an API key",
                    code="annotation_provider_authentication_failed",
                )
            from google import genai
            from google.genai import types

            google_client = genai.Client(
                api_key=api_key,
                http_options=types.HttpOptions(
                    timeout=int(REQUEST_TIMEOUT_SECONDS * 1000),
                    retry_options=types.HttpRetryOptions(
                        attempts=MODEL_DISCOVERY_MAX_RETRIES + 1
                    ),
                ),
            )
            async for model in await google_client.aio.models.list():
                name = model.name
                if isinstance(name, str) and name:
                    ids.add(_strip_google_model_prefix(name))
        else:
            from openai import AsyncOpenAI

            openai_client = AsyncOpenAI(
                api_key=api_key or "no-key-required",
                base_url=wire.base_url,
                timeout=REQUEST_TIMEOUT_SECONDS,
                max_retries=MODEL_DISCOVERY_MAX_RETRIES,
            )
            async for model in openai_client.models.list():
                if isinstance(model.id, str) and model.id:
                    ids.add(model.id)
    except AnnotationAiError:
        raise
    except Exception as error:  # noqa: BLE001 - normalise every SDK failure shape
        raise _completion_error(error, "Model listing failed") from error
    return sorted(ids, key=str.lower)
