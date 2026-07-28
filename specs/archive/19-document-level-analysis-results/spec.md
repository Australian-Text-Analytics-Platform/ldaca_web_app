# Document-Level Concordance and Quotation Results

Issue: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/19

Status: Completed 2026-07-28.

## Required behavior

- Concordance and Quotation Run All store one immutable Result row per
  matching source document, with a stable internal source-row identity and a
  nested list of matches or quotation extracts.
- Result resources expose deterministic match and document page projections.
- Concordance Preview remains document-paged. Review Table View is match-paged;
  Dispersion View can page by Matches or Documents.
- Quotation Review can page by Matches, showing raw scalar result columns, or
  Documents, showing the highlighted reading view.
- Concordance Review density covers the complete immutable Result and is
  independent of table paging, sorting, and presentation mode.
- Result Publication always publishes one flat row per match or extract.
- Native Workspace schema 13 and portable archive format 12 are accepted;
  older formats are rejected without runtime migration or compatibility code.

## Non-goals

- Persisting `CONC_dispersion` or a density cache.
- Publishing nested document rows as Data Blocks.
- Changing Preview execution or caching semantics.
- Adding document/match paging choices to Concordance Table View.
