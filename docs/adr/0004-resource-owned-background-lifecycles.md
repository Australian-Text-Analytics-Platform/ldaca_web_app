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
