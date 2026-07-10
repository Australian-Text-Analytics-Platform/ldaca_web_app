# AGENTS.md

Start here before exploring. This monorepo (renamed from `ldaca_web_app`; PyPI now `ldaca-wordflow`) contains the LDaCA Wordflow web app and desktop app: a React 19 + Vite + Tauri frontend in `frontend/`, a FastAPI backend in `backend/`, and supporting Python/Rust packages in `docworkspace/` and `polars-text/`. Treat package manifests, CI workflows, and build scripts as the source of truth when docs disagree.

## Repo Map

- `frontend/`: React 19, Vite 8, TypeScript, Vitest, ESLint, Tauri desktop shell in `src-tauri/`
- `backend/`: FastAPI backend (PyPI: `ldaca-wordflow`, import: `ldaca_wordflow`), uv-managed, Python `>=3.14`
- `docworkspace/`: Python package for lazy Polars workspace/node graphs
- `polars-text/`: Rust/PyO3 + Python package for text-analysis primitives
- `polars-source-utils/`: Rust/PyO3 + Python package for serialized Polars plan source path listing/rewriting
- Root `package.json`: pnpm workspace command wrapper for `frontend`
- Root `pyproject.toml`: uv workspace shim; do not rely on `PYTHONPATH=src`

## Developer Documentation System

Use the developer guides for on-demand project context before broad code
exploration, especially when changing unfamiliar modules:

- Root guide: `docs/developer-guide/index.md`
- Backend guide: `backend/docs/developer-guide/index.md`
- Frontend guide: `frontend/docs/developer-guide/index.md`
- DocWorkspace guide: `docworkspace/docs/developer-guide/index.md`
- polars-text guide: `polars-text/docs/developer-guide/index.md`

Architecture pages describe only the big picture. Read the sibling guide pages
for lifecycle, state flow, workspace internals, analysis/worker logic, desktop
packaging, persistence, package APIs, and release details.

After future code, architecture, workflow, packaging, or API changes, update the
relevant developer-guide page when the old documentation would become
incomplete, misleading, or stale. Keep docs aligned with the code in the same
change whenever practical.

## Environment And Order

Use this order for a fresh task:

1. Confirm prerequisites: Node/pnpm, `uv`, Python `3.14+`, and Rust/Cargo if touching `polars-text` or Tauri.
2. From repo root, run `uv sync`.
3. Install JS deps from the repo root with `pnpm install` if `node_modules/` is absent.
4. Run package-specific checks from the package directory, or use root wrapper scripts that call `pnpm -C frontend ...`.

Do not set `PYTHONPATH` manually for normal local development. uv handles resolution. The packaged desktop runtime sets `PYTHONPATH` internally; that is a packaging detail, not a dev setup pattern.

When debugging local Python packages that `pyproject.toml` normally resolves from PyPI, prefer editable local installs or uv path sources so changes in sibling packages are tested directly instead of against a released wheel.

## Validated Commands

These were validated in this workspace and are the fastest reliable entry points for agents:

- Bootstrap: `uv sync` from repo root, passes.
- Frontend run: existing dev server responds on `http://127.0.0.1:3000/` with Vite HTML.
- Frontend build: `pnpm -C frontend build`, passes.
- Frontend tests: `pnpm -C frontend test -- --run`, passes (`27` files, `70` tests).
- Backend run: existing backend responds on `http://127.0.0.1:8001/health`.
- Backend tests: `cd backend && uv run pytest -q`, passes (`269` tests).
- `docworkspace` tests: `cd docworkspace && uv run pytest -q`, passes.
- `polars-text` tests: `cd polars-text && uv run pytest -q`, passes.
- `polars-source-utils` manifest check: `cd polars-source-utils && cargo metadata --format-version 1 --no-deps`, passes.

## Practical Rules For Agents

- Trust this file first, then check the nearest manifest, CI workflow, or build script before doing broad repo exploration.
- Prefer `pnpm -C frontend ...` from repo root for frontend commands.
- Prefer `uv run ...` inside Python package directories.
- Whenever you modify a Python project in this repo, run `uvx ty check` and `uv run pytest` from each affected Python package directory and make sure both commands pass before considering the work complete.
- Do not run backend tests from repo root; run them from `backend/`.
- If you touch desktop packaging, inspect `scripts/package_backend_runtime.py` and `frontend/scripts/stage-backend-runtime.mjs` before changing anything.
- Expect backend data under `~/Documents/ldaca` unless `DATA_ROOT` overrides it.
- Some `polars-text` features download Hugging Face assets on first use; avoid treating that as an unexpected network regression.
- When a change alters implementation wiring, public APIs, workflows, package boundaries, release steps, or important design rules, update the relevant `docs/developer-guide/` page in the same change.

## Implementation Comment Requirements

Comments and docstrings are part of this repo's navigation layer for people and
future AI agents. When adding or changing implementation code, update the
nearest module, class, function, component, hook, route, worker, store, helper,
and test/mock comments so they stay accurate.

- For every non-trivial code unit, explain why it exists, what job it was
  written to do, and the steps or flow clearly enough that a reader can picture
  how the unit works without re-deriving the whole body.
- Include caller or consumer context in the comment: `Used by`, `Called by`,
  `Rendered by`, `Invoked by`, `Triggered by`, or similar. Use `rg`, language
  server references, or nearby tests/routes/components to verify these callers
  instead of guessing.
- When the caller relationship is not obvious, explain why each important
  caller uses the unit, not only that it calls it. Capture the utility the caller
  gets, such as state ownership, validation, serialization, task orchestration,
  UI composition, or test isolation.
- For larger or branchy units, add `Flow:` or `Steps:` detail that names the
  main phases, important guards, side effects, and returned/raised outcomes.
- Keep generated, vendored, resource, and build-output files out of manual
  comment sweeps. If generated code needs different comments, change the
  generator or source template instead.
- Do not add empty narration that repeats obvious syntax. Tiny self-explanatory
  wrappers can stay brief, but any change that alters behavior, ownership,
  call-sites, or side effects should update the surrounding comment/docstring in
  the same patch.
- For broad comment work, audit with AST-aware scripts or equivalent structured
  checks plus targeted `rg` passes, repeat until missing caller/why/flow coverage
  is zero, and run the relevant package validation afterward.

## Codebase-Specific AI Rules

- Avoid eager `collect()` except at I/O boundaries, artifact writing, or final response serialization.
- Serialized Polars plan source path utilities live in `polars-source-utils`; do not add them back to `polars-text`.
- Keep backend routers thin. Validate request shapes in the router, then delegate business logic to `core/` or analysis helpers.
- Use `Depends(get_current_user)` for backend route authentication; do not bypass it in new routes.
- For worker tasks, follow the existing worker pattern: call `configure_worker_environment()` first, import heavy dependencies inside the worker function, and write large outputs to artifacts.
- In frontend code, do not add `useMemo`, `useCallback`, or `React.memo` for routine optimization. The repo uses React Compiler.
- React Flow (`@xyflow/react`) caches each node's `data` in its own internal state; the graph only re-syncs `setNodes` when a *visible* field in `nodeSignatureFor` changes (`useWorkspaceGraph.ts`). Any callback put on `node.data` that closes over volatile state NOT in that signature (e.g. `currentView`) will go **stale** on a plain view switch. Read such values live at call time (e.g. `useUIStore.getState().currentView`) instead of closing over them — this is what caused the "graph + button silently does nothing after switching tools" bug. When debugging hover-revealed graph/sidebar controls, test with a single continuous `page.mouse.move(x, y, { steps: N })`; stepped moves with waits create false "toolbar vanished / click intercepted" artifacts that tempt you into band-aids for the wrong root cause.

## Cutting A Release

Six registered version surfaces **must** agree before tagging — pip wheel metadata, npm package, Tauri bundler, Rust crate, the Tauri Cargo lock entry, and the workspace pyproject. Drift between them is what shipped the v0.4.3 "desktop says 0.4.2 / pip says 0.4.3" bug.

1. `pnpm bump-version <semver>` from repo root rewrites all six from one shared registry. Don't edit version strings by hand.
2. `pnpm check-versions` confirms they match; the release workflow additionally checks exact `v<version>` tag identity before desktop builds.
3. `pnpm deploy_frontend_to_backend` after the bump — `VITE_APP_VERSION` is baked into the FE bundle at build time, so the bundle inside `backend/src/ldaca_wordflow/resources/frontend/build/` needs refreshing too.
4. Commit, tag `vX.Y.Z` on `v0.4`, push the tag → release.yml fires → desktop assets + PyPI publish.

## CI-Relevant Checks

For typical frontend changes, run:

- `pnpm -C frontend build`
- `pnpm -C frontend test -- --run`
- `pnpm -C frontend lint`

Frontend changes are not complete until both `pnpm -C frontend test -- --run` and `pnpm -C frontend lint` have been run after the edit.

For backend changes, run:

- `cd backend && uv run pytest -q`

For changes in any Python project, also run from the affected package directory:

- `uvx ty check`
- `uv run pytest`

For package-specific work, run only the impacted package tests instead of the full monorepo.
