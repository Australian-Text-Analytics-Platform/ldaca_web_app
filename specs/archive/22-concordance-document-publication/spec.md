# Concordance Match And Document Publication

Issue: [#22](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/22)

## Accepted behavior

- Table View pages and publishes one row per Concordance Match.
- Dispersion View pages and publishes one row per stable source-row identity.
- Exact, case-sensitive matched text owns chart colour and Review legend state.
- In Review, visible terms intersected with selected relative-position bins
  control document rows, match markers, counts, and Document Publication.
- Separated filters are per source. Combined owns one frontend-only filter that
  is submitted independently to each source.
- Document Publication emits the required source document, required normalized
  newline-joined `CONC_extraction`, and optional metadata only.
- Checked zero-result sources produce schema-only Data Blocks, and multi-source
  publication is atomic.

## Compatibility boundary

The persisted kinds are `concordance_match_publication` and
`concordance_document_publication`. Native Workspace schema 14 and portable
archive format 13 are a strict cutover with no legacy alias or migration.

## Non-goals

- Backend Combined-mode orchestration.
- Per-match list columns in Document Publication.
- Issue #25 bulk selection or apply-to-all controls.
- Changes to Quotation publication.
