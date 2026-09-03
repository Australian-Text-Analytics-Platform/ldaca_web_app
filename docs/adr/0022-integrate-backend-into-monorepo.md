# ADR 0022: Integrate the Backend into the Monorepo

## Status

Accepted on 2026-08-13.

## Context

Wordflow's frontend, backend, packaging scripts, shared version, and desktop
runtime change together, but the backend was represented in the root repository
by a Git submodule. That split required coordinated commits and workflows for a
single product change, complicated initialized-clone upgrades, and made the
root commit insufficient to inspect or validate the complete application.

The standalone backend repository contains a large historical object pack.
Importing that history would impose an enduring checkout cost while adding
little value because the original repository can preserve its commits, tags,
releases, and links in archived form.

## Decision

Commit the backend tree from `1543d7ce341943cd48ff58a21d18f9b810259737`
(tree `2961bc8b6fee41e25252733f1ee247c2c3d8c8f5`) directly under `backend/`.
Import the snapshot, not the standalone Git history. Keep the old repository as
a read-only archive that points to the monorepo.

The root repository owns backend source, CI, and publication of the separately
installable `ldaca-wordflow` Python distribution. `polars-text`,
`polars-source-utils`, sample data, and the documentation publication mirror
remain submodules. `backend/pyproject.toml` remains the sole authority for uv
source overrides.

The generated frontend archive is not tracked. CI and release workflows build
and stage the SPA before packaging. Backend PyPI and desktop publication are
independently and manually dispatched; production publication still requires
an exact root `vX.Y.Z` tag.

## Consequences

- One root commit now identifies the frontend, backend, contracts, packaging,
  CI, and release logic for the application.
- Backend changes no longer require a nested commit and parent gitlink update.
- Existing initialized clones require a one-time non-forced backend submodule
  deinitialization before pulling the cutover.
- Standalone backend history remains discoverable at its archived URL rather
  than increasing every Wordflow clone.
- PyPI trusted publishing must name the root repository and root
  `pypi-release.yml`; the old publisher remains only until the first successful
  root-origin release.
- A production release fails closed while a declared registry dependency is
  unavailable, even when source-aware CI succeeds from a sibling submodule.
