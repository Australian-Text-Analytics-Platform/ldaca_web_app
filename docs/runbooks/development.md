# Development Runbook

## Bootstrap

From the repository root:

```bash
git submodule update --init --recursive
uv sync
pnpm install
```

Do not set `PYTHONPATH` for normal development. Root uv sources resolve the
local backend and supporting packages; package-specific checks run from the
package root.

## Backend

```bash
cd backend
uv run pytest -q
uvx ty check
uv run uvicorn ldaca_wordflow.asgi:app --reload --port 8001
```

## Frontend

```bash
pnpm -C frontend dev
pnpm -C frontend check
```

Use `pnpm -C frontend docs:check` for the bundled user-document registry. After
an OpenAPI change, export the backend schema and regenerate the frontend client
through `pnpm -C frontend openapi:generate`; never edit generated files.

## Compiled Packages

```bash
cd polars-text
make build
make test
uvx ty check
```

```bash
cd polars-source-utils
uv sync
uv run maturin develop --release
uv run pytest -q
cargo metadata --format-version 1 --no-deps
```

Some tokenizer and embedding features download model assets on first use.

## Change Discipline

Run the nearest targeted check while editing and the complete affected-package
checks before handoff. Update architecture, domain, reference, runbook, ADR, or
specification documents in the same change whenever their truth changes.
