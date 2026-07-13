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
detachment, or materialization.
_Avoid_: child table, output node

**Analysis**:
A typed Wordflow operation that reads one or more Data Blocks and produces a
queryable Result, and sometimes Artifacts or Derived Data Blocks.
_Avoid_: computation job, analysis endpoint

**Task**:
The durable lifecycle record for background work, including analyses, imports,
and provider-backed operations.
_Avoid_: job, worker task, analysis task when the distinction is unnecessary

**Child Task**:
A Task owned by another Task for follow-up work such as detachment or
materialization.
_Avoid_: sub-job

**Result**:
The typed, queryable outcome of a successful Task. A Result is distinct from
any retained file that carries its large data.
_Avoid_: payload, artifact when referring to the typed outcome

**Artifact**:
A named retained file owned by a Task and exposed without revealing its host
filesystem path.
_Avoid_: result file when ownership matters, temporary file

**User File**:
A mutable file or folder in a user's import area. Adding it to a Workspace
creates an independent Source Data Block snapshot.
_Avoid_: source node, workspace file

**Data Root**:
The process-owned storage root containing users, workspaces, task state,
caches, and the authentication database.
_Avoid_: working directory, current directory

**Session**:
A hosted-browser authentication record identifying one user and its CSRF
proof. Desktop mode uses a process identity instead of a browser Session.
_Avoid_: access token, login token

**Revision**:
A monotonically increasing version used to detect conflicting Workspace or
Task updates.
_Avoid_: version when referring to optimistic concurrency

## Relationships

- A Workspace owns an ordered directed acyclic graph of Data Blocks.
- A Source Data Block snapshots a User File; later User File changes do not
  mutate the Data Block.
- A Derived Data Block records one or more parent Data Blocks.
- An Analysis executes as a Task and produces a Result.
- A Task may own Child Tasks and Artifacts.
- A hosted Session identifies a user; desktop mode identifies its one user by
  the backend process.
