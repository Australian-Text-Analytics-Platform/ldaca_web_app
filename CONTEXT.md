# LDaCA Wordflow

LDaCA Wordflow is a text-analysis product for assembling datasets, deriving
new data, and running analyses while preserving data lineage. This file is the
project's domain glossary; it contains no implementation instructions or
temporary project status.

## Language

**Workspace**:
A user-owned analysis area containing an ordered lineage graph of Data Blocks.
At runtime, the backend permits at most one open Workspace per user; this is a
resource state, not a remembered client selection.
_Avoid_: project, document workspace, current workspace

**Data Block**:
A named tabular dataset in a Workspace, together with its lineage and analysis
metadata. Backend code and HTTP schemas represent a Data Block as a `Node`;
`Node` is an implementation/API term rather than the product term.
_Avoid_: node in product-facing prose, dataframe, table

**Document Column Preference**:
An optional Data Block convenience value identifying the raw-text column that
a newly added analysis selector should choose. A function may expose this
preference, the Tokenizer Preference, both, or neither. The two preferences are
independent, and a submitted Analysis retains its own document-column mapping.
_Avoid_: required document column, Analysis document parameter

**Tokenizer Preference**:
An optional Data Block convenience value identifying the tokenizer model that
a newly added analysis selector should choose. It is independent of the
Document Column Preference and is neither an Analysis parameter nor cached
token content. A submitted Analysis retains its own tokenizer-model mapping.
_Avoid_: tokenization column, account tokenizer default, cached tokenizer

**Semantic Column Type**:
A globally named column meaning layered over a physical tabular storage type.
It may be owned by Wordflow or by the producer of imported data and remains
part of the Data Block schema even when Wordflow has no specialized behavior
for it.
_Avoid_: inferred column shape, Wordflow-only custom type

**Source Data Block**:
A Data Block created by snapshotting an imported User File into a Workspace.
It has no parent Data Block.
_Avoid_: uploaded node, root node

**Derived Data Block**:
A Data Block created from one or more parent Data Blocks by a transformation,
including a Supporting Analysis such as detachment.
_Avoid_: child table, output node

**Workspace SQL Query**:
A stateless SQL command evaluated against explicitly declared Data Blocks in
one Workspace. It either returns one tabular page or creates a Derived Data
Block; it never edits a Data Block in place.
_Avoid_: SQL session, database query, SQL edit

**Data Block Edit**:
An identity-preserving replacement of one Data Block's tabular execution plan.
It changes neither creation lineage nor any descendant Data Block's independent
plan. Session Undo/Redo is interaction history for these edits, not provenance
or a durable audit trail.
_Avoid_: derivation, lineage update, saved edit history

**Tab**:
A named Workspace-owned analysis slot with a fixed analysis kind and an ordered
Analysis Forest. Kind-specific presentation settings may belong to the Tab;
Active Analysis Drafts do not.
_Avoid_: frontend-only tab, singleton analysis slot

**Analysis**:
A Workspace-owned lifecycle record for one immutable typed text-analysis
request. Every Analysis belongs to one Tab and may optionally name a parent in
that Tab. A successful Analysis may produce a queryable Result, own Artifacts,
or atomically create zero or more Derived Data Blocks.
_Avoid_: task, job, analysis endpoint

**Result**:
The output-only typed outcome of a successful Analysis. Lifecycle, immutable
request parameters, and ownership remain on the Analysis. A Result is distinct
from any retained file that carries its large data and from browser-local
presentation settings.
_Avoid_: payload, artifact when referring to the typed outcome

**Result Publication**:
A Supporting Analysis that creates one or more Derived Data Blocks from
user-selected columns of a successful parent Analysis Result. Computing a
Result and publishing it to the Workspace are separate operations.
_Avoid_: detach action, automatic Run All output

**Concordance Match**:
One matched span in one source document, identified by its exact matched text
and character offsets. A matching document may contain multiple Concordance
Matches; Review may page either unit, while Result Publication always emits
one row per Concordance Match.
_Avoid_: document hit, dispersion row, cached line

**Topic Distribution**:
The ordered per-document proportions for the outlier topic `-1` followed by
every real topic in ascending ID order. Every entry is present, absent
proportions are zero, and the proportions sum to approximately one. It is
distinct from the single dominant topic assigned to the document.
_Avoid_: variable topic list, dominant topic

**Artifact**:
A named retained file owned by an Analysis and exposed without revealing its
host filesystem path.
_Avoid_: result file when ownership matters, temporary file

**User File**:
A mutable file or folder in a user's import area. Adding it to a Workspace
creates an independent Source Data Block snapshot.
_Avoid_: source node, workspace file

**Loadable User File**:
A stored User File whose filename extension is supported for creating a Source
Data Block. Unsupported assets remain User Files but are not loadable.
_Avoid_: previewable file, supported upload

**User File Import**:
A user-owned retained lifecycle record for publishing a complete sample or
Data Portal collection into the User File area. It is not Workspace content
and has no generic background-work parent.
_Avoid_: import task, download job

**Data Root**:
The configured storage root containing users, Workspaces, User File Import
records, caches, response snapshots, and the authentication database.
_Avoid_: working directory, current directory

**Session**:
A hosted-browser authentication record identifying one user and its CSRF
proof. Single-user mode uses the canonical Root User process identity instead
of a browser Session.
_Avoid_: access token, login token

**Revision**:
A monotonically increasing durable resource version used by Workspaces, Tabs,
Analyses, and User File Imports. Live progress events do not advance it.
_Avoid_: version when referring to optimistic concurrency

**Progress**:
The strict optional fraction and public message describing live Analysis or
User File Import execution. Intermediate Progress is ephemeral; only creation
and terminal transitions persist it.
_Avoid_: durable progress log, execution phase tree

**Guided Tour**:
A replayable multi-step orientation that a user deliberately starts.
_Avoid_: automatic tour, contextual hint

**Contextual Hint**:
A single versioned guidance message requested after a relevant user action.
_Avoid_: tour step, coach-mark scheduler

**Inline Guidance**:
Persistent explanatory copy, empty-state instruction, or disabled-control
reason presented as part of the interface.
_Avoid_: contextual hint, tooltip

**Tooltip**:
A brief hover or focus clarification attached to one interface control.
_Avoid_: help article, contextual hint

**Hint Acknowledgment History**:
The device-local record of the highest Contextual Hint version acknowledged by
each user.
_Avoid_: dismissal list, account preference

**User Preferences**:
A user's synchronized, non-secret choices that apply across their Wordflow
sessions.
_Avoid_: Workspace state, credential store, device state

**Provider Credential**:
A user-owned secret that authorizes Wordflow to call an external provider on
that user's behalf. An Annotation Provider Configuration may contain one
write-only Provider Credential. The secret is consumed only for the provider
request and is neither synchronized User Preferences nor portable Workspace,
Analysis, or User File Import state.
_Avoid_: API-key preference, Analysis parameter, Workspace secret

**Annotation Provider Configuration**:
An ordered, user-named Annotation connection with an opaque identity, provider
type, immutable provider locator, and one optional write-only Provider
Credential. Multiple configurations may use the same provider type or display
name. An Analysis retains the selected safe identity, type, and Custom base URL,
but never the display name or credential.
_Avoid_: provider type, credential slot, model preference

**Analysis Execution Scope**:
The declared role of an Analysis in a Tab: Preview, Run All, or Supporting.
Scope describes intent and presentation; it does not create a separate
lifecycle or resource type.
_Avoid_: task mode, endpoint type

**Analysis Forest**:
The ordered collection of Analysis trees owned by one Tab. Any Analysis may
reference one parent in the same Tab, and a Tab may own multiple independent
roots.
_Avoid_: current Analysis, singleton run

**Analysis Group**:
A thin coordinating Analysis whose Supporting descendants perform independent
work that must be presented or published as one outcome. Two-source
Concordance Run All is an Analysis Group.
_Avoid_: batch task, combined worker

**Sub-Analysis**:
An Analysis with a `parent_analysis_id`. A Sub-Analysis has the same lifecycle,
request, Result, cancellation, and persistence rules as any other Analysis and
may itself own Sub-Analyses.
_Avoid_: direct child task, operation

**Active Analysis Draft**:
Unsaved parameter and input changes for one open Tab. The draft exists only in
the current client presentation session and is discarded when the user leaves
that Tab. It is not an Analysis, Result, or synchronized preference.
_Avoid_: cached Analysis, server draft

**Review**:
The post-Run-All view of durable output. Annotation Review reads the edited
source Data Block; Concordance and Quotation Review read immutable Result
tables without requiring a published Data Block.
_Avoid_: preview result, detached output

**Example Data Block**:
An optional Annotation input whose nonblank text and label pairs are supplied
as verbatim examples to Preview and Run All.
_Avoid_: training data, cached prompt

**Codebook**:
An Annotation Data Block containing a code column and a description column.
Each row defines one candidate code and its meaning for Manual Annotation, AI
Preview, and Run All.
_Avoid_: class descriptions, class-description node

**User Correction Column**:
A string column selected from the Annotation Manual, Preview, or Review table
toolbar. The Tab keeps the live selection per source Data Block, while each
submitted Analysis captures an immutable snapshot of that selection for
provenance. Selecting **None** or using **Clear Results** removes the live Tab
selection without deleting the column or its values. Explicit reviewer choices
are written there as Data Block Edits; AI Preview predictions are never written
automatically.
_Avoid_: prediction column, hidden review state

## Relationships

- A Workspace owns an ordered directed acyclic graph of Data Blocks.
- A Workspace also owns its Tabs and every Analysis reachable from them.
- A user's backend resources contain zero or one open Workspace. Other
  Workspaces may be closed or closing, and a client does not infer an open
  Workspace from device history.
- A Source Data Block snapshots a User File; later User File changes do not
  mutate the Data Block.
- Only a Loadable User File can become a Source Data Block.
- A Derived Data Block records one or more parent Data Blocks.
- A Data Block may have a Document Column Preference, a Tokenizer Preference,
  both, or neither. Analysis controls expose and persist only the preferences
  they use, and submitted Analyses retain their exact mappings independently.
- A Semantic Column Type remains part of a Data Block's schema across storage,
  derivation, and tabular transport; an unknown producer does not erase it.
- A Workspace SQL Query may read only its declared Data Blocks. SQL creation
  records every declared Data Block as an ordered parent, whether or not the
  submitted SQL references every binding.
- Data Block provenance records creation lineage only. A Data Block Edit
  changes the selected Data Block's plan without changing its identity,
  parents, descendants, graph edges, or provenance.
- A Tab owns one ordered Analysis Forest and may contain multiple roots.
- An Analysis may own Sub-Analyses and Artifacts at arbitrary depth.
- Preview, Run All, and Supporting are Analysis Execution Scopes, not separate
  resource kinds or fixed parent-child positions.
- A successful Analysis may explicitly supersede terminal Analyses in the same
  Tab. Failure or cancellation preserves the predecessors.
- A User File Import belongs to one user independently of every Workspace.
- A hosted Session identifies a user; single-user mode always identifies the
  fixed Root User by the backend process.
- User Preferences belong to one user independently of every Workspace.
- Annotation Provider Configurations belong to one user. Their Provider
  Credentials never belong to User Preferences, a Workspace, an Analysis, or a
  User File Import.
- Hint Acknowledgment History is device-local and does not belong to User
  Preferences.
- Manual Annotation is a sequence of Data Block Edits. AI Annotation Preview
  uses a Preview-scoped Analysis whose page queries never write predicted
  labels. Explicit reviewer corrections are Data Block Edits. Annotation Run
  All is an independent Run-All-scoped Analysis that edits the selected source
  column in place.
- Concordance and Quotation Run All retain immutable Result tables and do not
  change the Data Block graph. A separate Result Publication may create Derived
  Data Blocks from selected Result columns.
