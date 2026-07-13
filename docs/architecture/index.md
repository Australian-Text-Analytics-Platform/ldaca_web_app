# Architecture

- [System overview](system-overview.md) describes the monorepo and end-to-end
  runtime.
- [Backend overview](backend/overview.md) routes into FastAPI lifecycle,
  Workspace, Task, and HTTP boundaries.
- [Frontend overview](frontend/overview.md) covers the React application,
  state ownership, and desktop shell.
- [polars-text](packages/polars-text.md) and
  [polars-source-utils](packages/polars-source-utils.md) describe the compiled
  supporting packages.

Architecture pages state current ownership and dependency direction. Product
meaning belongs in `docs/domain/`; operational commands belong in
`docs/runbooks/`; exact interfaces belong in `docs/reference/`.
