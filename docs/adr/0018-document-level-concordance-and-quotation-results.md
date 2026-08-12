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

The backend exposes explicit document and match projections. Without a requested
sort, both use stable source order; match projections additionally order by the
Concordance start offset or quotation row index. Non-materialized Concordance
Preview pages sort only by selected source metadata. A materialized Concordance
match projection may instead sort directly by any public scalar Result field.
That direct sort uses Polars' case-sensitive ordering and null defaults, adds no
hidden secondary keys, and therefore leaves equal-key order unspecified.
Quotation Result Data Block Creation and Concordance Match Data Block Creation explode the
nested Result. Concordance Document Data Block Creation instead filters the nested
matches by exact surface form and relative-position bins, keeps source-row
identity, and emits the document, normalized newline-joined extraction, and
selected metadata.

Concordance density is computed by a dedicated side-effect-free endpoint over
the complete immutable child Result. It returns 100 fixed bins keyed by exact
matched text and is neither a stored artifact nor a page-local cache.

Native Workspace schema 15 and portable archive format 14 are a strict cutover.
Older layouts are rejected without a compatibility reader or runtime migration.

## Consequences

- Concordance Table View is match-wise and Dispersion View is document-wise
  without rewriting the canonical Result.
- Concordance density is stable across table pagination and sorting.
- The internal source-row ID remains hidden and gives unsorted projections
  deterministic order without changing an explicit Concordance match sort.
- Concordance Match Data Block Creation preserves the one-occurrence-per-row
  contract; Concordance Document Data Block Creation creates a distinct
  one-source-row-per-document contract.

## Supersession

This decision supersedes ADR 0015's clause that Concordance Review reconstructs
groups from flat physical occurrence rows. It refines ADR 0016's immutable
Run All table contract by defining the canonical nested document shape and its
projection resources.
