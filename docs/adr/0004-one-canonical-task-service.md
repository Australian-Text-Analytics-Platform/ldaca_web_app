---
status: accepted
---

# One canonical Task service

Every background operation is represented by `TaskService`; executors own only
execution handles. The service owns durable state transitions, cancellation,
restart reconciliation, parent/child relations, events, Artifacts, and
idempotent completion. Feature-specific Task managers are rejected because
their public records and lifecycle decisions can diverge from the rest of the
system.
