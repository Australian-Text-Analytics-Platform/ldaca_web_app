---
status: accepted
---

# Document-Level Concordance and Quotation Results

## Context

Concordance and Quotation Run All previously retained one physical row per
match or extract. Review then regrouped those rows in the browser, which mixed
storage identity with presentation and made document paging and whole-Result
density depend on page-local reconstruction.

## Decision

Run All stores one immutable Result row per matching source document. Each row
contains source fields, an internal stable source-row ID, and a nested list of
Concordance Matches or quotation extracts. Documents without a match are not
stored.

The backend exposes explicit document and match projections. Both use stable
source order; match projections additionally order by the Concordance start
offset or quotation row index. Generated analysis fields are not sortable.
Quotation Result Publication and Concordance Match Publication explode the
nested Result. Concordance Document Publication instead filters the nested
matches by exact surface form and relative-position bins, keeps source-row
identity, and emits the document, normalized newline-joined extraction, and
selected metadata.

Concordance density is computed by a dedicated side-effect-free endpoint over
the complete immutable child Result. It returns 100 fixed bins keyed by exact
matched text and is neither a stored artifact nor a page-local cache.

Native Workspace schema 14 and portable archive format 13 are a strict cutover.
Older layouts are rejected without a compatibility reader or runtime migration.

## Consequences

- Concordance Table View is match-wise and Dispersion View is document-wise
  without rewriting the canonical Result.
- Concordance density is stable across table pagination and sorting.
- The internal source-row ID remains hidden but gives projections deterministic
  order.
- Match Publication preserves the one-occurrence-per-row contract; Document
  Publication creates a distinct one-source-row-per-document contract.

## Supersession

This decision supersedes ADR 0015's clause that Concordance Review reconstructs
groups from flat physical occurrence rows. It refines ADR 0016's immutable
Run All table contract by defining the canonical nested document shape and its
projection resources.
