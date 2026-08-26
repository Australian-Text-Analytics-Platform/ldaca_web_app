# Development Runbook

## Bootstrap

From the repository root:

```bash
git submodule update --init --recursive
uv sync
pnpm install
```

The backend is an ordinary tracked directory. The recursive submodule update
initializes the supporting package, documentation, and sample-data repositories.
Do not set `PYTHONPATH` for normal development. Root uv sources resolve the
local backend and supporting packages; package-specific checks run from the
package root.

### Existing clones from before the backend integration

Before pulling the commit that replaces the backend submodule, first preserve
or publish any backend-local work, then run:

```bash
git -C backend status --short --branch
git submodule deinit -- backend
git pull --ff-only
git submodule sync --recursive
git submodule update --init --recursive
```

Do not force deinitialization. Stop if the first command reports local changes
or commits that have not been backed up or pushed.

## Backend

```bash
cd backend
uv run ruff check .
uv run pytest -q
uv run ty check
CORS_ALLOWED_ORIGINS='["http://localhost:3000","http://127.0.0.1:3000"]' \
  uv run uvicorn ldaca_wordflow.asgi:app --reload --port 8001
```

## Frontend

```bash
pnpm -C frontend dev
pnpm -C frontend check
```

Run the backend and frontend commands in separate terminals. Vite serves the
frontend on port `3000` and connects directly to the backend on port `8001`.
Use either `http://localhost:3000` or `http://127.0.0.1:3000`; the frontend
preserves that hostname when it selects `localhost:8001` or `127.0.0.1:8001`.
Both exact frontend origins must therefore remain in the backend allowlist for
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
Root CI runs the complete frontend suite and a Linux, macOS, and Windows backend
matrix from the same commit. Its backend sync is source-aware, so
`backend/pyproject.toml` remains the authority for local versus registry
dependencies.
