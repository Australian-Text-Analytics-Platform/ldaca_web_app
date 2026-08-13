"""Unit probes for Annotation inference batching and provider dispatch."""

import asyncio
import uuid

import pytest

from ldaca_wordflow.domain import AnnotationClass
from ldaca_wordflow.domain.workspace import (
    AnnotationAnalysisRequest,
    AnnotationRunAllAnalysisRequest,
)
from ldaca_wordflow.infrastructure.providers.annotation_ai import (
    AnnotationAiError,
    AnnotationContextLimitError,
    AnnotationResponseError,
    InferenceConfig,
    _completion_error,
    _complete_openai,
    _complete_google,
    align_labels,
    annotate_all,
    annotate_preview,
    build_annotation_system_prompt,
    _reasoning_budget_tokens,
    list_models,
    resolve_provider_wire,
)


class _ProviderStatusError(Exception):
    def __init__(self, status_code: int, message: str = "private response body") -> None:
        super().__init__(message)
        self.status_code = status_code


@pytest.mark.parametrize(
    ("error", "code", "retryable"),
    [
        (_ProviderStatusError(401), "annotation_provider_authentication_failed", False),
        (_ProviderStatusError(403), "annotation_provider_access_denied", False),
        (_ProviderStatusError(429), "annotation_provider_rate_limited", True),
        (_ProviderStatusError(422), "annotation_provider_request_rejected", False),
        (_ProviderStatusError(503), "annotation_provider_unavailable", True),
        (TimeoutError("private endpoint"), "annotation_provider_unavailable", True),
        (RuntimeError("private unknown"), "annotation_provider_failed", False),
    ],
)
def test_provider_sdk_errors_have_stable_safe_categories(
    error: Exception,
    code: str,
    retryable: bool,
) -> None:
    classified = _completion_error(error, "fallback")

    assert classified.code == code
    assert classified.retryable is retryable
    assert "private" not in classified.safe_message


def test_provider_context_errors_are_classified_before_http_status() -> None:
    error = _ProviderStatusError(400, "maximum context length exceeded: private")

    classified = _completion_error(error, "fallback")

    assert classified.code == "annotation_provider_context_limit"
    assert classified.retryable is False


def _inference_config() -> InferenceConfig:
    return InferenceConfig(
        temperature=0.0,
        reasoning_enabled=False,
        reasoning_effort="medium",
    )


def _source_request() -> AnnotationAnalysisRequest:
    return AnnotationAnalysisRequest(
        node_id=uuid.uuid4(),
        text_column="text",
        annotation_column="annotation",
        class_node_id=uuid.uuid4(),
        class_column="class",
        description_column="description",
        classes=[AnnotationClass(name="positive")],
        provider_configuration_id=uuid.uuid4(),
        provider="openai",
        model="some-model",
        instruction="Classify the text",
    )


def _run_all_request(*, batch_size: int = 20) -> AnnotationRunAllAnalysisRequest:
    return AnnotationRunAllAnalysisRequest(
        source=_source_request(),
        batch_size=batch_size,
    )


def test_reasoning_budget_tokens_orders_low_below_high():
    low = _reasoning_budget_tokens("low")
    medium = _reasoning_budget_tokens("medium")
    high = _reasoning_budget_tokens("high")
    assert low < medium < high


def test_align_labels_matches_unicode_casefolds_and_preserves_null() -> None:
    assert align_labels(
        '{"labels": ["STRASSE", null]}',
        2,
        ["Straße"],
    ) == ["Straße", None]


def test_system_prompt_makes_the_batch_contract_authoritative() -> None:
    prompt = build_annotation_system_prompt(
        "Respond with only the chosen class label.",
        [AnnotationClass(name="positive")],
    )

    assert (
        "The batch and JSON response rules below take precedence over any conflicting "
        "response-format wording in the instruction."
    ) in prompt


def test_custom_provider_wire_uses_the_immutable_openai_compatible_base_url():
    wire = resolve_provider_wire("custom", "http://127.0.0.1:8080/v1")

    assert wire.chat_style == "openai"
    assert wire.base_url == "http://127.0.0.1:8080/v1"
    assert wire.supports_json_response_format is False


# --- OpenAI SDK dispatch probes -------------------------------------------------
#
# The endpoint tests monkeypatch ``annotate_preview``/``list_models`` wholesale, so
# the real OpenAI-path streaming branch has no
# other coverage. The fakes below stand in for the parts of the async SDK those
# branches touch: ``chat.completions.create`` returns one completion (recording its
# kwargs so we can assert ``stream=False``) and ``models.list()`` yields an async
# iterator of id-bearing objects like the SDK's paginator.


class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str, *, finish_reason: str = "stop") -> None:
        self.message = _FakeMessage(content)
        self.finish_reason = finish_reason


class _FakeCompletion:
    def __init__(self, content: str, *, finish_reason: str = "stop") -> None:
        self.choices = [_FakeChoice(content, finish_reason=finish_reason)]


class _FakeModel:
    def __init__(self, model_id: str) -> None:
        self.id = model_id


class _AsyncModelIterator:
    """Async-iterable stand-in for the SDK's ``models.list()`` paginator."""

    def __init__(self, ids: list[str]) -> None:
        self._models = [_FakeModel(model_id) for model_id in ids]

    def __aiter__(self):
        async def _gen():
            for model in self._models:
                yield model

        return _gen()


def _install_fake_openai(monkeypatch, *, model_ids: list[str] | None = None) -> dict:
    """Patch ``openai.AsyncOpenAI`` with a fake and return the create-kwargs sink.

    The returned dict is populated with whatever ``chat.completions.create`` is
    called with, letting a test assert the wire shape (notably ``stream``).
    """
    create_kwargs: dict = {}

    class _FakeCompletions:
        async def create(self, **kwargs):
            create_kwargs.update(kwargs)
            return _FakeCompletion("positive")

    class _FakeChat:
        def __init__(self) -> None:
            self.completions = _FakeCompletions()

    class _FakeModels:
        def list(self):
            return _AsyncModelIterator(model_ids or [])

    class _FakeAsyncOpenAI:
        def __init__(self, **_kwargs) -> None:
            self.chat = _FakeChat()
            self.models = _FakeModels()

    monkeypatch.setattr("openai.AsyncOpenAI", _FakeAsyncOpenAI)
    return create_kwargs


async def test_complete_openai_always_disables_streaming(monkeypatch):
    # Pin stream=False so a server cannot hand back an SSE body unexpectedly.
    create_kwargs = _install_fake_openai(monkeypatch)
    wire = resolve_provider_wire("openai")
    result = await _complete_openai(
        wire, "some-model", "key", "system", "user", _inference_config()
    )
    assert result == "positive"
    assert create_kwargs["stream"] is False


async def test_complete_openai_classifies_context_limit_errors(monkeypatch):
    class _ContextLimitedCompletions:
        async def create(self, **_kwargs):
            raise RuntimeError("maximum context length exceeded")

    class _FakeChat:
        def __init__(self) -> None:
            self.completions = _ContextLimitedCompletions()

    class _FakeAsyncOpenAI:
        def __init__(self, **_kwargs) -> None:
            self.chat = _FakeChat()

    monkeypatch.setattr("openai.AsyncOpenAI", _FakeAsyncOpenAI)

    with pytest.raises(AnnotationContextLimitError):
        await _complete_openai(
            resolve_provider_wire("openai"),
            "some-model",
            "key",
            "system",
            "user",
            _inference_config(),
        )


async def test_custom_model_discovery_uses_its_base_url_and_allows_no_key(
    monkeypatch,
):
    constructor_kwargs: dict = {}

    class _FakeModels:
        def list(self):
            return _AsyncModelIterator(["local-model"])

    class _FakeAsyncOpenAI:
        def __init__(self, **kwargs) -> None:
            constructor_kwargs.update(kwargs)
            self.models = _FakeModels()

    monkeypatch.setattr("openai.AsyncOpenAI", _FakeAsyncOpenAI)
    wire = resolve_provider_wire("custom", "http://localhost:8080/v1")

    models = await list_models(wire, None)

    assert models == ["local-model"]
    assert constructor_kwargs["base_url"] == "http://localhost:8080/v1"
    assert constructor_kwargs["api_key"] == "no-key-required"


async def test_google_model_discovery_has_bounded_timeout_and_retry(monkeypatch):
    constructor_kwargs: dict = {}

    class _Models:
        async def list(self):
            async def items():
                yield type("Model", (), {"name": "models/gemini-test"})()

            return items()

    class _Aio:
        def __init__(self) -> None:
            self.models = _Models()

    class _Client:
        def __init__(self, **kwargs) -> None:
            constructor_kwargs.update(kwargs)
            self.aio = _Aio()

    monkeypatch.setattr("google.genai.Client", _Client)

    models = await list_models(resolve_provider_wire("google"), "key")

    assert models == ["gemini-test"]
    http_options = constructor_kwargs["http_options"]
    assert http_options.timeout == 90_000
    assert http_options.retry_options.attempts == 2


async def test_custom_chat_completion_uses_its_base_url_and_allows_no_key(
    monkeypatch,
):
    constructor_kwargs: dict = {}
    create_kwargs: dict = {}

    class _FakeCompletions:
        async def create(self, **kwargs):
            create_kwargs.update(kwargs)
            return _FakeCompletion('{"labels": ["positive"]}')

    class _FakeChat:
        def __init__(self) -> None:
            self.completions = _FakeCompletions()

    class _FakeAsyncOpenAI:
        def __init__(self, **kwargs) -> None:
            constructor_kwargs.update(kwargs)
            self.chat = _FakeChat()

    monkeypatch.setattr("openai.AsyncOpenAI", _FakeAsyncOpenAI)
    wire = resolve_provider_wire("custom", "http://localhost:8080/v1")

    result = await _complete_openai(
        wire, "local-model", None, "system", "user", _inference_config()
    )

    assert result == '{"labels": ["positive"]}'
    assert constructor_kwargs["base_url"] == "http://localhost:8080/v1"
    assert constructor_kwargs["api_key"] == "no-key-required"
    assert create_kwargs["model"] == "local-model"


async def test_annotation_preview_retries_a_truncated_openrouter_completion(
    monkeypatch,
):
    constructor_kwargs: list[dict] = []
    create_kwargs: list[dict] = []
    completions = iter(
        [
            _FakeCompletion(
                '{"labels": ["positive", "positive", "positive"]',
                finish_reason="length",
            ),
            _FakeCompletion('{"labels": ["positive"]}'),
        ]
    )

    class _FakeCompletions:
        async def create(self, **kwargs):
            create_kwargs.append(kwargs)
            return next(completions)

    class _FakeChat:
        def __init__(self) -> None:
            self.completions = _FakeCompletions()

    class _FakeAsyncOpenAI:
        def __init__(self, **kwargs) -> None:
            constructor_kwargs.append(kwargs)
            self.chat = _FakeChat()

    monkeypatch.setattr("openai.AsyncOpenAI", _FakeAsyncOpenAI)
    request = _source_request().model_copy(
        update={"provider": "openrouter", "max_retries_per_batch": 2}
    )

    labels = await annotate_preview(request, "key", ["one input"])

    assert labels == ["positive"]
    assert len(create_kwargs) == 2
    assert {kwargs["max_completion_tokens"] for kwargs in create_kwargs} == {4096}
    assert {kwargs["max_retries"] for kwargs in constructor_kwargs} == {0}


async def test_annotation_preview_rejects_the_wrong_number_of_labels_after_retries(
    monkeypatch,
):
    attempts = 0

    class _FakeCompletions:
        async def create(self, **_kwargs):
            nonlocal attempts
            attempts += 1
            return _FakeCompletion('{"labels": ["positive", "positive"]}')

    class _FakeChat:
        def __init__(self) -> None:
            self.completions = _FakeCompletions()

    class _FakeAsyncOpenAI:
        def __init__(self, **_kwargs) -> None:
            self.chat = _FakeChat()

    monkeypatch.setattr("openai.AsyncOpenAI", _FakeAsyncOpenAI)
    request = _source_request().model_copy(update={"max_retries_per_batch": 1})

    with pytest.raises(
        AnnotationResponseError,
        match="exactly one label per input text",
    ):
        await annotate_preview(request, "key", ["one input"])

    assert attempts == 2


async def test_google_completion_disables_sdk_retries_and_bounds_output(monkeypatch):
    constructor_kwargs: dict = {}
    generate_kwargs: dict = {}

    class _FakeModels:
        async def generate_content(self, **kwargs):
            generate_kwargs.update(kwargs)
            return type("Response", (), {"text": '{"labels": ["positive"]}'})()

    class _FakeAio:
        def __init__(self) -> None:
            self.models = _FakeModels()

    class _FakeClient:
        def __init__(self, **kwargs) -> None:
            constructor_kwargs.update(kwargs)
            self.aio = _FakeAio()

    monkeypatch.setattr("google.genai.Client", _FakeClient)

    await _complete_google(
        "some-model",
        "key",
        "system",
        "user",
        _inference_config(),
    )

    retry_options = constructor_kwargs["http_options"].retry_options
    assert retry_options is not None
    assert retry_options.attempts == 1
    assert constructor_kwargs["http_options"].timeout == 90_000
    assert generate_kwargs["config"].max_output_tokens == 4096


async def test_annotate_all_uses_twenty_row_batches_with_ten_in_flight(
    monkeypatch,
):
    active = 0
    max_active = 0
    chunk_sizes: list[int] = []

    async def fake_annotate_batch(
        _wire,
        _model,
        _api_key,
        _instruction,
        _classes,
        texts,
        _config,
        _max_retries,
        _examples,
    ):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        chunk_sizes.append(len(texts))
        await asyncio.sleep(0.01)
        active -= 1
        return list(texts)

    monkeypatch.setattr(
        "ldaca_wordflow.infrastructure.providers.annotation_ai._annotate_batch",
        fake_annotate_batch,
    )

    texts = [str(index) for index in range(201)]
    outcome = await annotate_all(
        _run_all_request(),
        "key",
        texts,
    )

    assert outcome.labels == texts
    assert outcome.failed_rows == [False] * len(texts)
    assert outcome.failed_batch_count == 0
    assert sorted(chunk_sizes) == [1, *([20] * 10)]
    assert max_active == 10


async def test_annotate_all_splits_only_batches_rejected_by_the_context_limit(
    monkeypatch,
):
    attempted_sizes: list[int] = []

    async def fake_annotate_batch(
        _wire,
        _model,
        _api_key,
        _instruction,
        _classes,
        texts,
        _config,
        _max_retries,
        _examples,
    ):
        attempted_sizes.append(len(texts))
        if len(texts) > 25:
            raise AnnotationContextLimitError("maximum context length exceeded")
        return list(texts)

    monkeypatch.setattr(
        "ldaca_wordflow.infrastructure.providers.annotation_ai._annotate_batch",
        fake_annotate_batch,
    )

    texts = [str(index) for index in range(100)]
    outcome = await annotate_all(
        _run_all_request(batch_size=100),
        "key",
        texts,
    )

    assert outcome.labels == texts
    assert outcome.failed_rows == [False] * len(texts)
    assert outcome.failed_batch_count == 0
    assert sorted(attempted_sizes) == [25, 25, 25, 25, 50, 50, 100]


async def test_annotate_all_splits_batches_with_exhausted_invalid_responses(
    monkeypatch,
):
    attempted_sizes: list[int] = []

    async def fake_annotate_batch(
        _wire,
        _model,
        _api_key,
        _instruction,
        _classes,
        texts,
        _config,
        _max_retries,
        _examples,
    ):
        attempted_sizes.append(len(texts))
        if len(texts) > 25:
            raise AnnotationResponseError("invalid batch response")
        return list(texts)

    monkeypatch.setattr(
        "ldaca_wordflow.infrastructure.providers.annotation_ai._annotate_batch",
        fake_annotate_batch,
    )

    texts = [str(index) for index in range(100)]
    outcome = await annotate_all(
        _run_all_request(batch_size=100),
        "key",
        texts,
    )

    assert outcome.labels == texts
    assert outcome.failed_rows == [False] * len(texts)
    assert outcome.failed_batch_count == 0
    assert sorted(attempted_sizes) == [25, 25, 25, 25, 50, 50, 100]


async def test_annotate_all_treats_provider_wide_failures_as_fatal(
    monkeypatch,
):
    progress: list[tuple[int, int, int]] = []

    async def fake_annotate_batch(
        _wire,
        _model,
        _api_key,
        _instruction,
        _classes,
        texts,
        _config,
        _max_retries,
        _examples,
    ):
        if texts[0] == "20":
            raise AnnotationAiError(
                "provider unavailable",
                code="annotation_provider_unavailable",
                retryable=True,
            )
        return list(texts)

    monkeypatch.setattr(
        "ldaca_wordflow.infrastructure.providers.annotation_ai._annotate_batch",
        fake_annotate_batch,
    )

    with pytest.raises(AnnotationAiError) as exc_info:
        await annotate_all(
            _run_all_request(),
            "key",
            [str(index) for index in range(45)],
            progress_callback=lambda completed, total, failed: progress.append(
                (completed, total, failed)
            ),
        )

    assert exc_info.value.code == "annotation_provider_unavailable"


@pytest.mark.parametrize(
    "failure_type",
    [AnnotationContextLimitError, AnnotationResponseError],
)
async def test_annotate_all_marks_only_irreducible_row_local_failures(
    monkeypatch,
    failure_type,
):
    async def fake_annotate_batch(
        _wire,
        _model,
        _api_key,
        _instruction,
        _classes,
        texts,
        _config,
        _max_retries,
        _examples,
    ):
        if "bad" in texts:
            raise failure_type("private provider detail")
        return [None for _text in texts]

    monkeypatch.setattr(
        "ldaca_wordflow.infrastructure.providers.annotation_ai._annotate_batch",
        fake_annotate_batch,
    )

    outcome = await annotate_all(
        _run_all_request(batch_size=3),
        "key",
        ["good", "bad", "also-good"],
    )

    assert outcome.labels == [None, None, None]
    assert outcome.failed_rows == [False, True, False]
    assert outcome.failed_batch_count == 1
    assert outcome.failed_row_count == 1
