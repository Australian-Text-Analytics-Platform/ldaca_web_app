# Analyses And User File Imports

Wordflow has two durable kinds of background work. Analyses belong to a
Workspace Tab. User File Imports belong directly to a user. They share
lifecycle vocabulary and event transport, but there is no generic Task
resource, repository, or API.

```mermaid
flowchart LR
    WORKSPACE["Workspace"] --> TAB["Tab"]
    TAB --> FOREST["Ordered Analysis forest"]
    FOREST --> ROOT["Root Analysis"]
    ROOT --> SUB["Optional Sub-Analysis"]
    SUB --> DEEP["Optional deeper Sub-Analysis"]
    ROOT --> RESULT["Typed Result"]
    RESULT --> CREATION["Optional Derived Data Block Creation"]
    CREATION --> OUTPUTS["Derived Data Blocks"]

    USER["User"] --> IMPORT["User File Import"]
    IMPORT --> FILES["Published User Files"]
```

## Shared Lifecycle Meaning

Analyses and User File Imports use `queued`, `running`, `succeeded`, `failed`,
and `cancelled`. Their strict domain models validate transitions, timestamps,
Failure, Progress, Result presence, and Revision.

A cancellation request is not terminal cancellation. Queued work can cancel
immediately; running work becomes `cancelled` only after execution has stopped.
If success and confirmed cancellation race, the first terminal state committed
under the owning gate wins. Intermediate Progress is an in-memory service
overlay and SSE event. It does not rewrite the durable resource or advance its
Revision.

## Analysis Forest

Each Tab owns an ordered list of Analysis identities. Those records form a
forest:

- an Analysis with no `parent_analysis_id` is a root;
- a Sub-Analysis names one parent in the same Tab;
- parent links may have arbitrary depth and must remain acyclic;
- every Analysis appears exactly once in its Tab's ordered collection.

An Analysis declares one execution scope:

- `preview` answers page-oriented exploration without publishing a Data Block;
- `run_all` processes the complete immutable input;
- `supporting` performs work owned by another Analysis, such as one source of a
  multi-source Concordance Run All.

Scope does not change lifecycle semantics. Preview and Run All are independent
roots unless a concrete workflow chooses a parent. A user may run Run All
without first running Preview, and any Analysis kind may use a Supporting
Sub-Analysis when orchestration requires it.

The immutable request, execution scope, parent, explicit supersession targets,
lifecycle, safe Failure, terminal Result, Artifact references, and ordered
unique `output_node_ids` persist in each strict Analysis record. Draft
parameters and presentation preferences remain client-only Tab state.

## Submission, Supersession, Cancellation, And Clearing

Submission validates the complete request and commits the new Analysis as
`queued` before runtime capacity is available. Input snapshotting occurs only
when the scheduler selects it. Workers receive immutable private inputs rather
than a live Workspace.

A new Analysis may name terminal Analyses in the same Tab through
`supersedes_analysis_ids`. The predecessors remain readable while the
replacement is queued or running. Successful completion removes them; failed
or cancelled replacement preserves them. Annotation is the deliberate linear
exception: submitting a new Preview or Run All immediately removes the Tab's
previous Analysis and creates one replacement root. Annotation never owns
multiple live Analysis identities or Supporting Analyses.

Cancelling an Analysis cascades to its active descendants. A thin group
Analysis that has no scheduled worker is never signalled as though it owned a
process. Clearing a Tab cancels active work and removes the complete forest.
Deleting a Tab performs the same Analysis cleanup before removing the Tab.

## Results And Immutable Inputs

Successful Analyses store a strict kind-specific Result, edit a Data Block
through an explicit in-place contract, or publish output Data Blocks atomically.
Concordance and Quotation retain immutable Run All tables as Analysis-owned
Artifacts. Their Review pages remain tied to the submitted request and Result
rather than a current Workspace projection. Preview page queries are
side-effect free and are not persisted as cached Result pages.

Token Frequency and Concordance execute exclusively from the immutable request
and input snapshot. Tokenizer mappings never fall back to mutable Data Block
preferences. `native:plain_words_en` bypasses the token cache; other models use
the per-user content-addressed cache.

## Annotation

Manual Annotation is not an Analysis. Creating an annotation column, choosing a
code, and saving a Codebook are ordinary Data Block Edits. Its
**Compare To** selection is shared with Preview and Review for the same Data
Block. Each selected comparison column is projected into the table with its
selected reliability score in the header and exact confusion-matrix counts
available on hover or focus. Only string and categorical columns are comparison
targets. Percent Agreement, Cohen's Kappa, and nominal Krippendorff's Alpha are
available; Cohen's Kappa is the default. The metric choice is presentation
state keyed by source Data Block and shared across all three modes. The initial
counts and score cover the whole current Data Block. After a manual label is
saved, the frontend adjusts the affected aggregate pairs and recalculates the
selected score without rescanning the Data Block; failed saves do not change
the comparison. Changes made through another surface are reconciled when the
comparison resource next refetches.

AI Annotation Preview is a Preview-scoped Analysis. Each requested page is
fresh inference over the retained snapshot. Predictions are never written
automatically. Reviewer corrections are explicit `set_cell` Data Block Edits
to the correction column currently selected by the Tab. The immutable request
retains the selection captured at submission for provenance, but never
overwrites newer Tab state. Selecting **None** or using **Clear Results** clears
the live selection without deleting the column or its values. Preview renders
the prediction and selected editable correction as separate columns with an
intervening arrow. Preview comparisons reuse the same header-level presentation as
Review, but count only the fresh predictions and selected comparison-column
values on the current Preview page. Selected comparison columns appear as
read-only columns after the optional correction column. Their headers show
the selected reliability measure with its conventional `%`, `κ`, or `α` sign
and expose the exact current-page confusion-matrix counts on hover or focus.

Annotation Run All is an independent Run-All-scoped Analysis. It processes the
complete snapshot and writes the selected annotation column in place. The
correction column never changes Run All predictions. **Reprocess all rows**
replaces the annotation column and is the default; **Fill missing only** sends
only blank annotation rows and preserves every existing label. A provider batch
accepts only a complete row-aligned JSON label array. Invalid responses are
retried, then recursively split so a degenerate large reply does not discard
otherwise valid rows. A terminal provider batch contributes null labels while
successful batches are still committed, keeping every output row aligned.
The durable Result records attempted rows, failed terminal batches, and failed
rows so partial completion remains explicit after the commit.
Submitting it replaces the current Annotation Preview or Run All immediately;
a later Run All likewise replaces the earlier Run All.

Annotation Review shows the document and read-only completed annotation, plus
the selected editable correction column, with other columns available through
the metadata selector. Manual exposes the same correction selector while also
keeping the annotation editable. Preview and Review can use the selected
correction as the Example Data Block; Manual intentionally omits that shortcut.
The shared table footer provides rows-per-page selection and direct numbered pagination.
**Compare To** accepts one or more other columns and adds them as read-only
table columns after the optional correction column in Manual and Run All
Review. Each selected column header shows the selected reliability score and
exposes its exact confusion-matrix counts on hover or focus. The metric is
shared with Manual and Preview. Its counts and score cover the complete current
Data Block rather than only the visible Review page.

## Concordance And Quotation

Concordance and Quotation Preview use Preview-scoped Analyses. Each requested
page is computed from the retained immutable snapshot.

Quotation Run All is one Run-All-scoped Analysis with one immutable nested
document Result. Concordance Run All is a thin Run-All-scoped Analysis Group
with one Supporting Sub-Analysis and nested document Result per selected
source. Supporting work executes independently, but the group succeeds only
after every source Result is durable.

Review reads explicit projections of those Results. A
matching document is one stored row and owns a nested list of Concordance
Matches or quotation extracts. `CONC_dispersion` is derived by the frontend and
is never stored as a backend column. Concordance Table View reads matches;
Dispersion View filters and pages documents. Quotation retains its existing
document or match Review projections.

**Add to Workspace** submits a typed Supporting Analysis under the successful
Run All parent. Concordance Match Data Block Creation emits selected flat match
columns. Concordance Document Data Block Creation emits the required document
and newline-joined `CONC_extraction` plus optional metadata after applying the
Review term/bin filter. Checked sources, including empty ones, are committed
atomically. Run All itself never changes the Workspace graph.

## Other Analysis Kinds

Token Frequency, Trends, Topic Modelling, and other full-table functions submit
Run-All-scoped Analyses directly. Topic Modelling Data Block Creation remains
an ordinary Supporting Analysis and may create multiple ordered output Data
Blocks.

A Topic Modelling Analysis request owns one segmentation method and maximum
token count for all selected Data Blocks. The successful Result records the
total Topic Segment count and how many semantic segments were truncated.
Automatic segmentation may split and overlap text; Paragraph and Sentence
segmentation preserve their respective Unicode text boundaries and truncate an
oversized segment on the right.

## Persistence

Closing and reopening a Workspace restores Tabs, terminal Analysis forests,
immutable requests, stored Results, Artifacts, and retained query inputs.
Native Workspace schema 13 and portable archive format 12 accept only this
forest representation. Older layouts are rejected without runtime migration.
Browser-local active Tab selection and Active Analysis Drafts are outside both
storage forms.

## User File Import

A User File Import is retained under one user's `users/<user-id>/imports/`
area as one strict atomic JSON record. It represents publication of either a
complete sample collection or one Data Portal collection into User Files. Its
persisted request contains no provider credential.

A Data Portal submission may carry a write-only token for the initial provider
operation. The service resolves it before retaining the import and passes it
only through the private execution context.

User File Imports have their own service, scheduler, capacity, execution
handles, cancellation, persistence, and cleanup. They do not belong to a
Workspace and cannot create or mutate an Analysis. Deleting a terminal import
deletes only its history record, not published User Files.

## Event Refresh

Both resource types publish changes and live Progress through the authenticated
`/api/events` stream. Events are refresh signals, not a second state store.
Reconnects refetch resources, and slow subscribers receive `resync_required`
rather than historical replay.
