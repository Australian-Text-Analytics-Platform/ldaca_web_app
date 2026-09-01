"""Complete backend diagnostics without traceback disclosure."""

from __future__ import annotations

from ldaca_wordflow.domain.background import Failure
from ldaca_wordflow.shared.errors import format_exception_diagnostic


def test_formats_unwrapped_exception_type_and_message() -> None:
    assert format_exception_diagnostic(ValueError("invalid value")) == (
        "ValueError: invalid value"
    )


def test_follows_explicit_cause_to_the_originating_exception() -> None:
    cause = OSError("disk full")
    wrapper = RuntimeError("write failed")
    wrapper.__cause__ = cause

    assert format_exception_diagnostic(wrapper) == "OSError: disk full"


def test_follows_unsuppressed_implicit_context() -> None:
    cause = LookupError("missing record")
    wrapper = RuntimeError("load failed")
    wrapper.__context__ = cause

    assert format_exception_diagnostic(wrapper) == "LookupError: missing record"


def test_suppressed_context_is_not_exposed() -> None:
    wrapper = RuntimeError("load failed")
    wrapper.__context__ = LookupError("private context")
    wrapper.__suppress_context__ = True

    assert format_exception_diagnostic(wrapper) == "RuntimeError: load failed"


def test_empty_message_returns_only_the_exception_type() -> None:
    assert format_exception_diagnostic(RuntimeError()) == "RuntimeError"


def test_cause_cycles_are_bounded() -> None:
    first = RuntimeError("first")
    second = ValueError("second")
    first.__cause__ = second
    second.__cause__ = first

    assert format_exception_diagnostic(first) == "ValueError: second"


def test_message_is_not_truncated() -> None:
    message = "x" * 10_000

    assert format_exception_diagnostic(RuntimeError(message)) == (
        f"RuntimeError: {message}"
    )


def test_durable_failure_accepts_an_unbounded_multiline_diagnostic() -> None:
    message = "ValueError: first line\n" + ("x" * 10_000)

    failure = Failure(code="analysis_execution_failed", message=message)

    assert failure.message == message
