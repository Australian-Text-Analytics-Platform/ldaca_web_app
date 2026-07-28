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
Result Publication always explodes the nested Result and publishes one flat row
per match or extract.

Concordance density is computed by a dedicated side-effect-free endpoint over
the complete immutable child Result. It returns 100 fixed bins keyed by exact
matched text and is neither a stored artifact nor a page-local cache.

Native Workspace schema 13 and portable archive format 12 are a strict cutover.
Older layouts are rejected without a compatibility reader or runtime migration.

## Consequences

- Review can page by the unit the interface presents without rewriting the
  canonical Result.
- Concordance density is stable across table pagination and sorting.
- The internal source-row ID remains hidden but gives projections deterministic
  order.
- Publication preserves its existing one-occurrence-per-row Data Block
  contract.

## Supersession

This decision supersedes ADR 0015's clause that Concordance Review reconstructs
groups from flat physical occurrence rows. It refines ADR 0016's immutable
Run All table contract by defining the canonical nested document shape and its
projection resources.
