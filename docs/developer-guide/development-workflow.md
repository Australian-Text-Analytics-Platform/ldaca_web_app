# Development Workflow

## Repository Boundaries

The repository contains nested project directories. `backend/`,
`docworkspace/`, `polars-text/`, and `polars-source-utils/` have their own
package manifests and tests. Treat those package roots as the working directory
for package-specific Python or Rust checks.

Use the root only for orchestration scripts, frontend wrappers, release checks,
and desktop packaging.

## Bootstrap

From the repository root:

```bash
uv sync
pnpm install
```

`uv sync` resolves the root workspace shim and uses the local backend package.
Do not set `PYTHONPATH` for normal development; uv and package manifests own
resolution.

## Source Dependencies In CI

The Python packages use `tool.uv.sources` for coordinated local development
across the root repo, `backend/`, `docworkspace/`, `polars-text/`, and
`polars-source-utils/`. Branch and pull-request CI should run in source mode:
check out the package under test plus the sibling repositories at the relative
paths declared in `pyproject.toml`, then run:

```bash
uv sync --frozen --group dev
```

Use `uv sync --no-sources` only when dependency versions are already available
from the package index. It is not the right default for coordinated branch work
because newly bumped sibling package versions may not be published yet.

## Frontend Checks

Run frontend commands through the root wrapper or with `pnpm -C frontend`:

```bash
pnpm -C frontend build
pnpm -C frontend test -- --run
pnpm -C frontend lint
pnpm -C frontend knip
```

Frontend work is not complete until tests and lint have run after the edit.
Run `knip` after export/dependency cleanup or when removing dead code; it is an
unused-export/dependency guard, not a replacement for build, tests, or lint.
The app uses React Compiler, so routine manual memoization is not part of the
normal development style.

## Backend Checks

Run backend tests from `backend/`, not from the repository root:

```bash
cd backend
uv run pytest -q
uvx ty check
```

Backend routers should validate request shape, call `Depends(get_current_user)`
where authentication is required, and delegate business logic to `core/`,
`analysis/`, or workspace helpers.

## Package Checks

For Python packages, run checks from the affected package directory:

```bash
uv run pytest -q
uvx ty check
```

For `polars-text`, the normal local extension flow is:

```bash
cd polars-text
make build
make test
```

Use the feature-scoped targets when iterating on one Rust surface:

```bash
make check-basic
make check-tokenization
make check-embedding
make check-topic
make build-tokenization
```

Cargo chooses its own parallel job count by default. Override it only when you
need a specific limit, for example `make build-tokenization JOBS=12`.

Some `polars-text` tokenizers download Hugging Face or Lindera assets on first
use. That is expected for tokenizer features and should not be treated as a
network regression without more evidence.

`polars-source-utils` owns serialized Polars plan source-path inspection and
rewriting. It carries the broad `polars-plan` feature surface needed for
workspace persistence so tokenizer-focused `polars-text` builds do not have to.

## Desktop Development

The desktop app depends on the frontend build and a packaged backend runtime.
Inspect these before changing desktop packaging:

- `scripts/package_backend_runtime.py`
- `frontend/scripts/stage-backend-runtime.mjs`
- `frontend/src-tauri/src/main.rs`
- `frontend/src-tauri/tauri.conf.json`

The desktop launcher starts the Python backend itself. The web frontend's API
base resolver reads the injected `window.__BACKEND_URL__` in desktop mode.
`pnpm desktop:dev` uses the same packaged-runtime path as desktop builds. Build
speedups should come from uv, Cargo, maturin, and sccache configuration rather
than a separate dev-only runtime mode.
