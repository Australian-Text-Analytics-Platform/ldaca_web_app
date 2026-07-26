---
status: accepted
---

# Generic Tab-Owned Analysis Forests

## Context

The one-root Preview Session model encoded UI sequencing as backend ownership.
It required Preview before Run All, limited follow-up work to direct children,
and forced multi-source Concordance orchestration into feature-specific seams.
The frontend also needed one persisted Analysis pointer even though a Tab could
have independent Preview, Run All, and Supporting work.

The product requires direct Run All, generic nested work, success-dependent
replacement, and one canonical lifecycle authority without restoring a generic
Task resource.

## Decision

A Tab owns an ordered Analysis forest.

Every Analysis records:

- an execution scope: Preview, Run All, or Supporting;
- an optional parent in the same Tab;
- zero or more terminal Analyses in the same Tab that it supersedes after
  successful completion.

Parent links may have arbitrary depth. Scope describes intent, not a separate
resource or state machine. Preview and Run All may be independent roots.
Supporting Analyses use the same scheduler, persistence, cancellation, Result,
Artifact, and output-publication contracts.

Replacement is explicit and success-dependent. Predecessors remain readable
while replacement runs and survive failure or cancellation. Clearing removes
the complete forest. Cancelling an Analysis cascades through active
descendants.

Two-source Concordance Run All is a thin Run All Analysis Group with one
Supporting Analysis per source. Children execute independently, while group
completion publishes all outputs or none. The thin group owns no worker
process.

The frontend obtains the complete forest through one TanStack Query resource
and derives current Preview, Run All, active work, and hydration candidates.
It does not store a second lifecycle pointer. Unsaved Active Analysis Drafts
remain presentation state and never enter Query data.

Concordance Review joins current source and Result Data Blocks using only
physical Run All columns, then reuses the standard Table and Dispersion
presentation. `CONC_dispersion` remains client-derived.

Native Workspace schema 9 and portable archive format 8 are a strict cutover.
There is no compatibility reader, singular Tab Analysis route, direct-child
route, or runtime migration.

## Consequences

- Any Analysis can be a Sub-Analysis of another when the workflow needs it.
- Run All no longer depends on Preview and full-table functions use the same
  execution-scope contract.
- The backend forest and immutable requests are the sole lifecycle and
  historical hydration authority.
- Multi-source group orchestration can reuse ordinary Analysis scheduling
  while retaining atomic publication.
- Clients must reason about a collection rather than one attached Analysis.
- Older Workspace and archive layouts must be operationally converted before
  the cutover or remain rejected.

## Supersession

This ADR supersedes ADR 0014's privileged root Preview Session and direct-child
Run All ownership. ADR 0010's separation of Analysis lifecycle from Result
projection remains in force.
