# LDaCA Wordflow

LDaCA Wordflow is a text-analysis product for assembling datasets, deriving
new data, and running analyses while preserving data lineage. This file is the
project's domain glossary; it contains no implementation instructions or
temporary project status.

## Language

**Workspace**:
A user-owned analysis area containing an ordered lineage graph of Data Blocks.
_Avoid_: project, document workspace, current workspace

**Data Block**:
A named tabular dataset in a Workspace, together with its lineage and analysis
metadata. Backend code and HTTP schemas represent a Data Block as a `Node`;
`Node` is an implementation/API term rather than the product term.
_Avoid_: node in product-facing prose, dataframe, table

**Source Data Block**:
A Data Block created by snapshotting an imported User File into a Workspace.
It has no parent Data Block.
_Avoid_: uploaded node, root node

**Derived Data Block**:
A Data Block created from one or more parent Data Blocks by a transformation,
including a child Analysis such as detachment.
_Avoid_: child table, output node

**Tab**:
A named Workspace-owned analysis slot with a fixed analysis kind and at most
one current root Analysis. Draft parameters and presentation state are not
part of the Tab.
_Avoid_: frontend-only tab, analysis history

**Analysis**:
A Workspace-owned lifecycle record for one typed text-analysis request. A root
Analysis belongs to one Tab; a successful Analysis produces a queryable Result
and may own Artifacts or create a Derived Data Block.
_Avoid_: task, job, analysis endpoint

**Child Analysis**:
An independently observable Analysis directly owned by a successful root
Analysis for a typed follow-up operation such as detachment. Children cannot
own further children.
_Avoid_: child task, sub-job, analysis operation

**Result**:
The typed, queryable outcome of a successful Analysis. A Result is distinct
from any retained file that carries its large data.
_Avoid_: payload, artifact when referring to the typed outcome

**Artifact**:
A named retained file owned by an Analysis and exposed without revealing its
host filesystem path.
_Avoid_: result file when ownership matters, temporary file

**User File**:
A mutable file or folder in a user's import area. Adding it to a Workspace
creates an independent Source Data Block snapshot.
_Avoid_: source node, workspace file

**User File Import**:
A user-owned retained lifecycle record for publishing a complete sample or
Data Portal collection into the User File area. It is not Workspace content
and has no generic background-work parent.
_Avoid_: import task, download job

**Data Root**:
The process-owned storage root containing users, Workspaces, User File Import
records, caches, response snapshots, and the authentication database.
_Avoid_: working directory, current directory

**Session**:
A hosted-browser authentication record identifying one user and its CSRF
proof. Desktop mode uses a process identity instead of a browser Session.
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

## Relationships

- A Workspace owns an ordered directed acyclic graph of Data Blocks.
- A Workspace also owns its Tabs and every Analysis reachable from them.
- A Source Data Block snapshots a User File; later User File changes do not
  mutate the Data Block.
- A Derived Data Block records one or more parent Data Blocks.
- A Tab may reference one root Analysis; clearing it permits a new root
  Analysis without retaining the old one as public history.
- A root Analysis may own direct Child Analyses and Artifacts.
- A User File Import belongs to one user independently of every Workspace.
- A hosted Session identifies a user; desktop mode identifies its one user by
  the backend process.
