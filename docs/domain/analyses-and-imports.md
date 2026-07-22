# Analyses And User File Imports

Wordflow has two durable kinds of background work, each owned by the resource
whose behavior it represents. They share lifecycle vocabulary and event
transport, but there is no generic Task resource, repository, API, or state
machine.

```mermaid
flowchart LR
    WORKSPACE["Workspace"] --> TAB["Tab"]
    TAB --> ROOT["Current root Analysis"]
    ROOT --> RESULT["Typed Result"]
    ROOT --> ARTIFACT["Optional Artifact"]
    ROOT --> CHILD["Optional direct Child Analysis"]
    CHILD --> DERIVED["Optional Derived Data Block"]

    USER["User"] --> IMPORT["User File Import"]
    IMPORT --> FILES["Published User Files"]
```

## Shared Lifecycle Meaning

Analyses and User File Imports both use `queued`, `running`, `succeeded`,
`failed`, and `cancelled`. Their own strict domain models validate transitions,
timestamps, Failure, Progress, Result presence, and Revision.

A cancellation request is not terminal cancellation. Queued work can cancel
immediately; running work becomes `cancelled` only after its execution has
stopped. If success and confirmed cancellation race, the first terminal state
committed under the owning gate wins. A system interruption fails the resource
with its specific interruption code and does not invent a user-cancellation
timestamp.

Intermediate Progress is a service-owned in-memory overlay and SSE event. It
does not rewrite the durable resource or advance its Revision. Creation and a
terminal transition persist Progress. A restart therefore loses intermediate
Progress and fails any retained non-terminal resource as interrupted; work is
never resumed or partially repaired.

## Analysis

An Analysis is portable Workspace content. A root Analysis is referenced by
one Tab, and the Tab kind fixes which discriminated root request it accepts.
The immutable request, lifecycle, safe Failure, terminal Result payload,
Artifact references, and the ordered unique `output_node_ids` list persist in a
strict per-Analysis record beneath the Workspace.

Execution snapshots are created only when the scheduler selects the Analysis.
The owning Data Blocks are reserved while the Analysis is queued or running,
and the selected worker receives immutable private inputs rather than a live
Workspace. Concordance and Quotation retain that run input after success so
later Result pages remain tied to the submitted request even if the current
source Data Block is edited. The stored first Result page is the canonical
default Result; alternate pages are side-effect-free projections over the
retained input. If the retained input is unavailable, the query fails rather
than silently recomputing from live Workspace state. Draft request parameters
and all presentation preferences remain outside the backend resource.

An Annotation submission may carry a write-only Provider Credential to the
execution boundary. The service removes it before creating the immutable
Analysis request, so persistence, hydration, retries, Tabs, Results, and
Artifacts never contain it.

Annotation has two deliberately separate modes. Manual Annotation is not an
Analysis: starting a manual column is an expression Data Block Edit, each label
selection is a `set_cell` edit, and one class-description dialog Save is an
`annotation_classes` edit. Its Undo and Redo behavior is therefore the selected
Data Block's ordinary session history. A dedicated empty class-description
Data Block may be created by a zero-row Workspace SQL projection.

AI Annotation preview is a side-effect-free query and creates no resource. AI
Run submits the Tab's durable Annotation Analysis through the same root
submission contract as every other analysis kind. Its immutable request,
lifecycle, Result, and derived Data Block output hydrate from backend resources
after reload; the frontend does not copy them into a feature store.

A successful concordance, quotation, or Topic Modeling root may own any number
of direct typed Child Analyses for supported detachment operations. A child is
an ordinary Analysis with `parent_analysis_id`; it has the same lifecycle and
event contract, cannot own a grandchild, and may atomically create one or more
Derived Data Blocks through the Workspace mutation boundary. Non-publishing
Analyses use an empty output list. Topic Modeling records each selected source's
semantic pair while ordering the flat identities as topic data followed by
topic meanings in source-request order.

`output_node_ids` is a strict current contract. Persisted records with the
removed singular field or no output list are corrupt rather than migrated.

Clearing a Tab immediately removes its root from the public resource graph and
allows a new root submission. Queued work is cancelled without starting;
running private execution finishes cancellation and cleanup without being able
to mutate the cleared Tab.

Closing and reopening a Workspace restores Tabs, terminal Analyses, immutable
requests, stored Results, Artifacts, and retained query inputs from Workspace
storage. Portable archive version 4 carries terminal live Analyses and safe
materialized copies of their query inputs; import rebuilds private lazy input
snapshots under the new Workspace identity. Browser-local active Tab and
presentation settings are deliberately outside both storage forms.

## User File Import

A User File Import is retained under one user's `users/<user-id>/imports/`
area as one strict atomic JSON record. It represents publication of either a
complete sample collection or one Data Portal collection into User Files. Its
persisted request contains no provider credential.

A Data Portal submission may carry a write-only token for the initial provider
operation. The service resolves it before retaining the import and passes it
only through the private execution context; restart recovery therefore never
attempts to restore or expose a personal token.

Sample collections come only from the canonical remote sample-data repository.
The backend fetches its catalogue on demand, downloads the selected files
directly into private staging, and publishes the complete collection under
`files/sample_data/<collection-id>/`. The backend package carries no sample
manifest, dataset copy, digest registry, or local-source fallback.

User File Imports have their own service, fair runtime-only scheduler, capacity,
execution handles, cancellation, persistence, and cleanup. They do not belong
to a Workspace and cannot create or mutate an Analysis. A successful import
records the public destination, file count, and bytes written; deleting a
terminal import deletes only its history record, not the published User Files.

## Event Refresh

Both resource types publish changes and live Progress through the single
authenticated `/api/events` stream. Events identify the authoritative resource
and its latest Revision where one was durably committed. They are refresh
signals, not a second state store: reconnecting clients refetch resources, and
slow subscribers receive `resync_required` rather than historical replay.
