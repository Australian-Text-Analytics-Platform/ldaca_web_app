# Generic Tab-Owned Analysis Forest

Issue: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/17

## Problem

The former one-root Preview Session model coupled Tab state to one Analysis and
made direct Run All, generic sub-analyses, and multi-source orchestration
feature-specific. Frontend features also retained transient Analysis identifiers
that duplicated the backend-owned lifecycle.

## Required behavior

- A Tab owns an ordered forest of Analyses.
- Every Analysis declares whether it is Preview, Run All, or Supporting.
- Parent links may form arbitrary-depth trees within the same Tab.
- Preview and Run All may start independently.
- A replacement Analysis names the terminal Analyses it supersedes. Successful
  completion removes those predecessors; failed or cancelled replacement does
  not.
- Clearing a Tab removes its complete forest. Cancelling an Analysis cascades
  through its active descendants.
- A two-source Concordance Run All is one thin Run All group with one Supporting
  Analysis per source. The group publishes all outputs or none.
- The frontend derives lifecycle state from the canonical forest. It stores
  only tab presentation drafts and input settings outside TanStack Query.
- Concordance Review left-joins each source to its physical Result Data Block,
  then feeds that projection through the existing Table and Dispersion
  presentation. `CONC_dispersion` is never queried as a backend column.
- Native Workspace schema 9 and portable archive format 8 are accepted. Older
  versions are rejected without runtime migration.

## Acceptance criteria

- Only plural Tab Analysis collection operations remain.
- Preview, direct Run All, Supporting Analyses, supersession, cancellation, and
  forest clearing have backend contract tests.
- Annotation, Concordance, and Quotation share Preview, Run All, Stop, and Clear
  lifecycle controls without a singleton Tab Analysis link.
- Historical Preview or Run All requests hydrate the current feature.
- Concordance Review retains Table View, Dispersion View, metadata, pagination,
  and sorting while querying physical columns only.
- OpenAPI, generated SDK, durable documentation, package checks, and browser
  acceptance agree with the clean contract.

## Non-goals

- Restoring removed detach endpoints or materialization controls.
- Adding compatibility readers, routes, aliases, or runtime migrations.
- Turning presentation-only columns into persisted backend columns.
