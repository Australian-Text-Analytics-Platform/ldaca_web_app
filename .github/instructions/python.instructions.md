---
description: 'Python coding conventions and guidelines for the LDaCA project'
applyTo: '**/*.py'
---

# Python Coding Conventions

## Environment & Tooling

- **Python ≥ 3.14** is required. Use modern syntax features available in 3.14+.
- **Package manager:** [uv](https://docs.astral.sh/uv/). Never use `pip install` directly.
  - `uv sync` — install all workspace dependencies (run from repo root).
  - `uv run <command>` — run any script or tool in the managed environment.
  - `uv add <package>` — add a dependency to the relevant workspace member.
- **Never** set `PYTHONPATH=src` — `uv sync` installs packages in editable mode automatically.

## Type Annotations

- Use **built-in generics** (PEP 585): `list[str]`, `dict[str, int]`, `tuple[int, ...]`, `set[str]`.
- Do NOT import `List`, `Dict`, `Tuple`, `Set`, `Optional` from `typing` — use `list`, `dict`, `tuple`, `set`, `X | None` instead.
- Use `X | None` instead of `Optional[X]` (PEP 604 union syntax).
- Use `type` statement for type aliases when appropriate (PEP 695).
- Include type hints on all function signatures and return types.

```python
# ✅ Modern Python 3.14 style
def process_items(items: list[str], options: dict[str, int] | None = None) -> list[str]:
    ...

# ❌ Outdated style — do NOT use
from typing import List, Dict, Optional
def process_items(items: List[str], options: Optional[Dict[str, int]] = None) -> List[str]:
    ...
```

## Code Style and Formatting

- Follow **PEP 8** with a relaxed line length (120 characters max, not 79).
- 4 spaces for indentation.
- Docstrings follow PEP 257 conventions.
- Prefer self-documenting code with descriptive names over excessive comments.

## FastAPI Patterns

- Keep routers thin — validate via Pydantic models, delegate business logic to `core/`.
- Use `Depends(get_current_user)` for authentication on all endpoints.
- Use `async def` for I/O-bound endpoints.
- Return Pydantic response models or typed dicts.

```python
@router.post("/{workspace_id}/my-analysis/submit")
async def submit_analysis(
    workspace_id: str,
    request: MyAnalysisRequest,
    current_user=Depends(get_current_user),
) -> dict:
    ...
```

## Polars (Lazy-First)

- All node data must be `pl.LazyFrame`. Never pass `DataFrame` where `LazyFrame` is expected.
- Avoid `.collect()` except at I/O boundaries (writing Parquet, serializing final API responses).
- Use `.lazy()` when creating frames from raw data.
- Prefer Polars expressions over Python loops for transforms.

## Testing (pytest)

- `asyncio_mode = "auto"` — no need for `@pytest.mark.asyncio` decorators.
- Run tests from the specific workspace member directory, not the repo root:
  ```sh
  cd backend && uv run pytest
  cd backend/docworkspace && uv run pytest
  ```
- Use `authenticated_client` fixture for auth-required endpoints.
- Use `test_client` fixture for single-user mode endpoints.

## General Principles

- Break complex functions into smaller, focused functions.
- Handle edge cases with explicit error handling — no silent failures.
- Use `raise` with specific exception types and meaningful messages.
- Prefer standard library and built-in data structures (`dict`, `set`, `deque`) for performance.
