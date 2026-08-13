"""Static guardrails for the backend application error contract.

Used by:
- backend endpoint cleanup work because route modules should raise semantic
  ``AppError`` subclasses and let ``main.app_error_handler`` produce the shared
  JSON envelope.
"""

from __future__ import annotations

import ast
from pathlib import Path


SRC_DIR = Path(__file__).parents[2] / "src" / "ldaca_wordflow"
RAW_HTTP_EXCEPTION_ALLOWED = {SRC_DIR / "core" / "exceptions.py"}


def test_application_code_uses_app_error_instead_of_raw_http_exception() -> None:
    """Application modules should not import or raise raw FastAPI HTTPException."""

    offenders: list[str] = []
    for path in sorted(SRC_DIR.rglob("*.py")):
        if "_vendor" in path.relative_to(SRC_DIR).parts:
            continue
        if path in RAW_HTTP_EXCEPTION_ALLOWED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        relative_path = path.relative_to(SRC_DIR)
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "fastapi":
                imported_names = {alias.name for alias in node.names}
                if "HTTPException" in imported_names:
                    offenders.append(f"{relative_path}: imports fastapi.HTTPException")
            if isinstance(node, ast.Raise):
                exc = node.exc
                if (
                    isinstance(exc, ast.Call)
                    and isinstance(exc.func, ast.Name)
                    and exc.func.id == "HTTPException"
                ):
                    offenders.append(
                        f"{relative_path}:{node.lineno} raises HTTPException"
                    )

    assert offenders == []
