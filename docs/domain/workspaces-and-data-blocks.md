# Workspaces And Data Blocks

## Workspace Identity

A Workspace is a user-owned resource addressed by UUID. Client selection does
not change its identity and is not persisted by the backend. A backend resident
Workspace is only an internal cache of that resource.

Every persisted Workspace has a monotonically increasing Revision. A mutating
HTTP request supplies the expected Revision; a stale write conflicts rather
than silently overwriting a newer graph.

## Data Block Graph

A Workspace owns an ordered directed acyclic graph of Data Blocks. Each Data
Block has stable identity, a name, a lazy tabular plan, optional document and
tokenization metadata, and zero or more parents. Roots are Source Data Blocks;
other blocks preserve the lineage of the transformation that created them.

Backend domain code calls this object a `Node`, matching the public API. Product
and domain documentation uses Data Block. A live backend `Node` may reference
only resolved parent objects; persisted parent IDs are reconstruction data and
must not leak into the live aggregate unresolved.

## Persistence Invariants

- Successful mutations publish a complete new snapshot and Revision before
  returning.
- A failed publication leaves the previous snapshot loadable.
- Ordinary loads are read-only and never relocate serialized plans.
- Archive import validates and stages the whole graph before making it
  discoverable.
- Workspace deletion cannot race active Task execution or completion.
- Removing a Data Block preserves graph validity and cannot orphan descendants.
