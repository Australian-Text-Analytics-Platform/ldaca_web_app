"""
JSON sanitization utilities for ensuring FastAPI can encode nested structures.

This module provides utilities to sanitize data before JSON serialization,
handling numpy types and non-string dict keys that would otherwise cause
serialization failures.
"""


def json_sanitize(obj):
    """Recursively sanitize an object for JSON serialization.
    
    This function handles:
    - Numpy scalar types -> Python scalars
    - Non-string dict keys -> string dict keys
    - Nested collections (lists, tuples, sets, dicts)
    - Pydantic-like models with model_dump() or dict() methods
    
    Args:
        obj: The object to sanitize
        
    Returns:
        A JSON-serializable version of the object
    """
    try:
        import numpy as _np  # type: ignore
    except Exception:  # pragma: no cover
        _np = None  # type: ignore

    # Primitives
    if obj is None or isinstance(obj, (str, bool, int, float)):
        return obj

    # Numpy scalar types -> Python scalars
    if _np is not None:
        try:
            if isinstance(obj, _np.generic):  # type: ignore[attr-defined]
                return obj.item()
        except Exception:
            pass

    # Collections
    if isinstance(obj, dict):
        sanitized = {}
        for k, v in obj.items():
            # Ensure keys are strings in JSON
            try:
                sk = k if isinstance(k, str) else str(json_sanitize(k))
            except Exception:
                sk = str(k)
            sanitized[sk] = json_sanitize(v)
        return sanitized

    if isinstance(obj, (list, tuple, set)):
        return [json_sanitize(x) for x in obj]

    # Pydantic-like models
    if hasattr(obj, "model_dump"):
        try:
            return json_sanitize(obj.model_dump())
        except Exception:
            pass
    if hasattr(obj, "dict"):
        try:
            return json_sanitize(obj.dict())  # type: ignore
        except Exception:
            pass

    # Fallback: best-effort stringification
    try:
        return str(obj)
    except Exception:
        return None
