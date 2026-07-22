---
status: accepted
---

# Separate Analysis lifecycle from Result projection

A Tab owns at most one current root Analysis. The Analysis is the durable
resource for its immutable typed request, lifecycle, Failure, Progress,
Artifacts, output Data Block identities, and direct Child Analyses. A Result is
the output-only projection that exists after success. The frontend follows this
same ownership chain with separate Tab, Analysis, and Result queries instead of
using feature-specific hydration or the Task Inbox as an alternate state store.

Successful Concordance and Quotation Analyses retain the immutable execution
input used by the run. Their stored first Result page is returned directly by
the default Result endpoint, while later pages are computed on demand from that
retained input. Recomputing from the current Data Block was rejected because an
in-place edit would silently change the meaning of an already completed
Analysis. If retained input is unavailable, the query returns an explicit
availability error.

The Task Inbox remains a lifecycle presentation and cache invalidation source
for the active Workspace's Analyses and the user's file imports. Active Tab
identity and display preferences are local to the browser, scoped by user and
Workspace or Tab. Submitted inputs recover from the immutable Analysis request,
so a client reload does not depend on an inbox entry or feature-owned cache.

Portable Workspace archive version 4 includes terminal live Analyses, declared
Artifacts, and materialized immutable query inputs. Import rebuilds and rebases
private lazy snapshots beneath a fresh Workspace identity. Serialized Polars
plans are not portable archive content, non-terminal Analyses are omitted, and
older archive versions are rejected rather than supported through a partial
compatibility path.
