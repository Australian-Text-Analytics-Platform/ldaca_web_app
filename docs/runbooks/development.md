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
uv run ruff check .
uv run pytest -q
uv run ty check
CORS_ALLOWED_ORIGINS='["http://localhost:3000"]' \
  uv run uvicorn ldaca_wordflow.asgi:app --reload --port 8001
```

## Frontend

```bash
pnpm -C frontend dev
pnpm -C frontend check
```

Run the backend and frontend commands in separate terminals. Vite serves the
frontend on `http://localhost:3000` and connects directly to the backend on
port `8001`; the exact backend Origin allowlist is therefore required for
unsafe CSRF-protected requests. Production does not use this split arrangement:
the release workflow builds the SPA into the backend package and the backend
serves both surfaces from one origin.

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
