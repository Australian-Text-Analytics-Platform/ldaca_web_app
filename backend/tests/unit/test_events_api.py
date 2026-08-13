"""Contracts for the unified backend event endpoint."""

from inspect import isasyncgenfunction

from ldaca_wordflow.api.events import backend_events


def test_backend_events_is_a_native_fastapi_sse_generator() -> None:
    """FastAPI only applies its SSE encoder to generator path operations."""

    assert isasyncgenfunction(backend_events)
