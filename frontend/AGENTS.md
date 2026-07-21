# Frontend operating guide

These rules extend the root `AGENTS.md` for the React, Vite, and Tauri package.
Read [the frontend architecture overview](../docs/architecture/frontend/overview.md)
before changing an unfamiliar state or desktop boundary.

## Ownership and state

- `src/api/generated/` is generated from backend OpenAPI. Never edit it by
  hand; change the backend schema or generator and regenerate.
- TanStack Query owns server state. Zustand stores own client and interaction
  state. Do not mirror the same authority across both systems.
- Feature behavior belongs under `src/features/`; shared visual primitives
  belong under the established component boundaries.
- Runtime backend URLs come from the API environment utilities. Do not hardcode
  `localhost` or assume a fixed packaged port.

## React rules

- The project uses React Compiler. Do not add `useMemo`, `useCallback`, or
  `React.memo` for routine optimization.
- Feature content rendered inside resizable or nested panes must respond to its
  available container width with intrinsic wrapping or named container queries.
  Reserve viewport breakpoints for surfaces whose width is owned by the viewport,
  such as mobile navigation and dialogs.
- React Flow caches node `data`. A callback stored there must not close over
  volatile state that is absent from `nodeSignatureFor`; read that value from
  its store at call time or deliberately include it in the resynchronization
  contract.
- Test hover-revealed graph controls with one continuous stepped pointer move;
  wait-separated moves can create false disappearance and interception results.

## Desktop and documentation

- Before changing packaging, read
  [the desktop architecture](../docs/architecture/frontend/desktop.md) and
  [desktop runtime runbook](../docs/runbooks/desktop-runtime.md), then inspect
  `scripts/package_backend_runtime.py` and
  `frontend/scripts/stage-backend-runtime.mjs`.
- Keep package-local `docs/user-guide/`, `docs/tutorials/`, and
  `docs/reference/` aligned with observable UI behavior. Engineering
  architecture remains in the repository-level `docs/` taxonomy.

## Commands

Run from the repository root:

```sh
pnpm -C frontend build
pnpm -C frontend test -- --run
pnpm -C frontend lint
pnpm -C frontend docs:check
```

Frontend changes are complete only after tests and lint pass. Run the build for
changes that affect compilation, bundling, generated code, or desktop staging.
