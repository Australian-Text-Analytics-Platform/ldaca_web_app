# Backend Monorepo Integration

Issue: [#59](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/59)

## Objective

Make the root repository authoritative for backend source, CI, and releases
without changing the `ldaca-wordflow` distribution, runtime behavior, public
API, persistence formats, or supporting-package repository boundaries.

## Contract

- Import backend commit `1543d7ce341943cd48ff58a21d18f9b810259737`,
  tree `2961bc8b6fee41e25252733f1ee247c2c3d8c8f5`, as ordinary files.
- Exclude the generated frontend archive and relocate backend workflows to the
  root workflow directory. Preserve every other imported path and byte except
  the ownership links, build-ignore rules, and packaging comment updated by
  this migration.
- Keep source-aware dependency selection in `backend/pyproject.toml`.
- Run frontend and cross-platform backend gates in root CI.
- Publish the backend distribution from a root `vX.Y.Z` tag only after
  release-specific validation with registry-only dependency resolution.
- Keep desktop publication manual and independent.
- Preserve standalone history by archiving, rather than deleting, the old
  repository after the root cutover and publisher migration.

## Non-goals

- Importing standalone backend Git history.
- Changing package names, versions, HTTP contracts, persistence schemas, or
  application behavior.
- Integrating any remaining submodule.
- Publishing a production version as part of this migration.
