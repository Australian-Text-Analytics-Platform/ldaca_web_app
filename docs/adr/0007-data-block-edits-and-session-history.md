---
status: accepted
---

# Keep Data Block Edits separate from creation lineage

Wordflow supports identity-preserving Data Block Edits alongside Derived Data
Block creation. Cast, column rename, and column delete are always edits.
Filter, Find, Create, and Polars Expression default to creating a Derived Data
Block but may explicitly update the selected Data Block. Sample, Join, and
Stack remain creation-only.

Provenance describes how a Data Block was created. It is not rewritten by an
edit, and graph edges and parent relationships remain unchanged. Each Data
Block owns an independent Polars lazy plan, so editing a parent does not
recompute or replace a descendant's plan.

Each open backend Data Block keeps independent Undo and Redo stacks of at most
50 lazy plans. A successful edit checkpoints the previous plan and clears
Redo. History is process-local, plan-only interaction state: snapshots and
archives persist only the current plan, and load, clone, import, close/reopen,
or process restart begins with empty stacks. Metadata reconciliation keeps a
Document Column Preference valid after an edit or history command, but that
adjustment is deliberately not undoable. [ADR 0012](0012-node-level-tokenizer-preference.md)
supersedes this decision's former tokenization-metadata reconciliation clause:
the scalar Tokenizer Preference is independent of columns and is not changed
by an edit or history command.

The Workspace mutation gate publishes the current plan and Revision for every
edit, Undo, and Redo. Publication rollback restores the previously committed
plan and the pre-existing runtime stacks. This gives rejected commands
transactional behavior without turning edit history into durable provenance or
an audit log.
