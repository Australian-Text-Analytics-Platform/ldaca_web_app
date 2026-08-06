---
status: accepted
---

# Resource-owned background lifecycles

Wordflow has no generic Task resource or service. An Analysis is portable
Workspace content whose lifecycle, Result, children, Artifacts, and completion
belong to `AnalysisService`. A User File Import is independent user-owned
history whose lifecycle, publication, and cleanup belong to
`UserFileImportService`.

The services share only small lifecycle values, a private fair-queue primitive,
and the `EventHub` refresh transport. They do not share durable identity,
persistence, scheduler capacity, executor state, cancellation, Result, or
cleanup ownership. This keeps each public resource self-contained and avoids a
second generic record that would duplicate or contradict its real owner.

An Analysis therefore owns an ordered `output_node_ids` list rather than a
separate Data Block Creation resource or a singular output slot. This lets one
typed child operation, such as Topic Modelling Data Block Creation, atomically
commit a semantic group of Derived Data Blocks while keeping lifecycle,
rollback, and lineage under the same Workspace mutation.
