"""JSON-safe row serialization helpers.

Used by:
- backend API routes, core workspace and worker services because they need a backend
  boundary that validates inputs before delegating to workspace or worker state.

Flow: convert Python values to JSON types, then stringify out-of-range integers so
    JavaScript receivers never lose precision.
"""

from typing import Any, cast, overload

from pydantic_core import to_jsonable_python

_JS_MAX_SAFE_INTEGER = 2**53 - 1


@overload
def serialize_json_rows(data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Type signature used by callers passing flat row payloads.

    Used by:
    - backend API routes, core workspace and worker services because they need a backend
      boundary that validates inputs before delegating to workspace or worker state.
    """
    ...


@overload
def serialize_json_rows(
    data: list[list[dict[str, Any]]],
) -> list[list[dict[str, Any]]]:
    """Type signature used by callers passing grouped row payloads.

    Used by:
    - backend API routes, core workspace and worker services because they need a backend
      boundary that validates inputs before delegating to workspace or worker state.
    """
    ...


def serialize_json_rows(
    data: list[dict[str, Any]] | list[list[dict[str, Any]]],
) -> list[dict[str, Any]] | list[list[dict[str, Any]]]:
    """Convert row values to JSON types without losing large integer precision.

    Pydantic's JSON conversion handles temporal, decimal, UUID, and nested values.
    JSON numbers are IEEE 754 doubles in JavaScript, so integers above 2^53-1 are
    then converted to strings to preserve their exact digits for display.

    Accepts both flat (``list[dict]``) and grouped (``list[list[dict]]``)
    row structures.

    Used by:
    - backend API routes, core workspace and worker services because they need a backend
      boundary that validates inputs before delegating to workspace or worker state.
    """
    def preserve_integers(value: Any) -> Any:
        if isinstance(value, bool):
            return value
        if isinstance(value, int) and abs(value) > _JS_MAX_SAFE_INTEGER:
            return str(value)
        if isinstance(value, list):
            return [preserve_integers(item) for item in value]
        if isinstance(value, dict):
            return {key: preserve_integers(item) for key, item in value.items()}
        return value

    return cast(
        list[dict[str, Any]] | list[list[dict[str, Any]]],
        preserve_integers(to_jsonable_python(data)),
    )


__all__ = ["serialize_json_rows"]
