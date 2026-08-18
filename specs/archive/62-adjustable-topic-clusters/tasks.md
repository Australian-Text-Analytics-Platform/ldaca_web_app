# Tasks

## Native projection

- [x] Fix Wordflow HDBSCAN leaf construction at `min_cluster_size = 10`.
- [x] Serialize and validate the versioned zstd MessagePack context.
- [x] Build deterministic weighted Ward merges and exact canonical cuts.
- [x] Recompute c-TF-IDF meanings, coordinates, assignments, corpus counts, and
  retained-character-weighted distributions for every supported count.
- [x] Preserve outliers and exclude them from the real-Topic count.

## Backend and persistence

- [x] Remove Minimum topic size from public Analysis and Result contracts.
- [x] Add Result query cluster count, bounds metadata, and strict 422, 410, and
  corrupt-context behavior without mutating the canonical Result.
- [x] Publish ordered Result sources and remove public assignment and meaning
  Artifact URLs.
- [x] Persist and validate the Tab-owned applied cluster selection.
- [x] Reproject and materialize matching Topic Data Blocks from the parent
  context.
- [x] Bump Workspace schema 17 to 18 and archive format 16 to 17 with strict
  rejection and context Artifact lifecycle coverage.
- [x] Regenerate the OpenAPI schema and frontend client.

## Frontend

- [x] Remove the Minimum topic size field, state, hydration, guidance, request,
  warning, and export metadata paths.
- [x] Add the official shadcn Slider and its Radix dependency without the
  generated `useMemo` wrapper.
- [x] Own the slider pointer transaction, commit the latest draft once on a
  normal release, roll interrupted gestures back without a request, give every
  changed drop a fresh no-store request identity, pass AbortSignal, isolate late
  responses, keep the last chart visible but inert, and support retryable
  projection rollback.
- [x] Settle each matching projection once and issue at most one Tab
  presentation PATCH after success.
- [x] Reset projection-owned interactions after success and disable export and
  Add to Workspace while a committed projection is unresolved.
- [x] Restore successful same-Analysis selections, reset new Analyses to their
  natural count, and capture the applied count for export and Data Block
  creation.
- [x] Replace the fixed SVG and brush zoom with a measured React Flow graph that
  fits every complete bubble and supports pan, wheel/pinch zoom, and native
  viewport controls.
- [x] Add sticky cumulative centre-hit lasso filtering, current-viewport image
  export, and graph-readiness integration with the projection lock.

## Documentation and verification

- [x] Add ADR 0024 and update architecture, domain, API, persistence, package,
  guidance, tutorial, export, and screenshot documentation.
- [x] Synchronize and validate the frontend documentation mirror.
- [x] Pass native Topic tests, the full `polars-text` build, backend Ruff, Ty,
  and 724 tests, and frontend lint, type, Knip, 1,110 tests, and production
  build gates.
- [x] Pass documentation links, Mermaid validation, version checks, and
  repository and nested-repository diff checks.
- [x] Complete live two-corpus 4 to 3 to 2 projection, unchanged-outlier,
  reload, rerun-reset, and matching Add-to-Workspace acceptance.
- [x] Complete live Browser and Chrome React Flow fit, pan, zoom, additive lasso,
  current-viewport export, and clean-console acceptance.
