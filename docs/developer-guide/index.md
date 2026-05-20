# Developer Guide Index

This guide is the developer map for the whole Wordflow monorepo. It is split
by project because each package has its own runtime boundary, dependency model,
and tests.

## Start Here

- [Architecture](architecture.md) describes the big-picture monorepo shape.
- [Development workflow](development-workflow.md) documents local setup,
  repository boundaries, and validation commands.
- [Release and packaging](release-and-packaging.md) explains version stamping,
  bundled frontend assets, desktop runtime packaging, and CI release flow.

## Project Guides

- [Backend developer guide](../../backend/docs/developer-guide/index.md)
- [Frontend developer guide](../../frontend/docs/developer-guide/index.md)
- [DocWorkspace developer guide](../../docworkspace/docs/developer-guide/index.md)
- [polars-text developer guide](../../polars-text/docs/developer-guide/index.md)

## How To Use These Docs

Architecture pages intentionally stay high level. For implementation details,
read the sibling pages in the same `developer-guide/` directory. The source
of truth remains the package manifests, build scripts, CI workflows, and code;
these docs explain how those pieces are wired together.
