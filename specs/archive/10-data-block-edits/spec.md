# Data Block Edits and session undo/redo

GitHub issue: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/10
Status: completed

## Problem

Every current data-changing operation creates a Derived Data Block. That
removed the identity-preserving column edits and session Undo/Redo controls
that users rely on for correcting a selected Data Block. It also makes
preprocessing create graph children even when the user deliberately wants to
replace the selected Data Block's execution plan.

## Desired behavior

- Column cast, rename, and delete always edit the selected Data Block.
- Filter, Find, Create, and Polars Expression default to creating a Derived
  Data Block and offer an explicit `Update selected Data Block` mode.
- Slice, random sample, shuffle, Join, and Stack always create Derived Data
  Blocks.
- A Data Block Edit replaces only the selected Data Block's lazy execution
  plan. Its identity, graph relationships, descendants, and creation
  provenance do not change.
- Every Data Block has independent Undo and Redo stacks containing at most 50
  lazy execution plans. A successful new edit records the previous plan and
  clears Redo.
- History exists only while the Workspace remains open in the backend process.
  Workspace snapshots, archives, clones, imports, and reopened Workspaces
  contain only the current plan and begin with empty history.
- Failed validation, explicit no-ops, and rejected persistence do not alter
  history. A persistence failure restores both the current plan and the
  pre-existing in-memory stacks.
- Forward edits keep document and tokenization metadata valid. Metadata changes
  are not included in Undo/Redo.
- Undo/Redo availability is returned by the backend and is the sole source for
  disabled state in the Data View and graph Data Block menus.

## API contract

- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/edits`
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/undo`
- `POST /api/workspaces/{workspace_id}/nodes/{node_id}/redo`
- `NodeEditRequest` is discriminated by `kind`: `cast`, `rename_column`,
  `delete_column`, `filter`, `replace`, or `expression`.
- The URL identifies the edited Data Block. Edit requests contain no source
  Data Block ID or new Data Block name.
- `WorkspaceNodeInfo` always contains `can_undo` and `can_redo`.
- Cast is not accepted by the Data Block creation union. Existing cast
  provenance remains loadable.

## Acceptance criteria

- All edit variants preserve Data Block identity and graph size.
- Editing a parent does not modify any descendant plan.
- Edits and history commands reject Data Blocks reserved by an Analysis.
- The current plan persists and advances the Workspace revision, while history
  resets after close/reopen.
- Eligible preprocessing tools route create and update modes to their respective
  commands with exact labels and reset semantics.
- Column dtype, rename, and delete controls use the edit command.
- Both Undo/Redo surfaces use backend flags and invalidate graph, node
  information, row, and schema queries after successful commands.
- Durable engineering docs and bundled tutorials describe Data Block Edits,
  creation-only lineage, create-only operations, and session-only plan history.

## Non-goals

- Recomputing descendants after editing a parent.
- Treating edit history as durable audit or provenance data.
- Undoing metadata reconciliation.
- Adding update modes to Sample, Join, or Stack.
- Persisting preprocessing mode as an account or device preference.
