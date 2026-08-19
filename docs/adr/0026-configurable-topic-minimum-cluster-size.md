---
status: accepted
---

# Configurable Topic Minimum Cluster Size

## Context

ADR 0024 fixed HDBSCAN's minimum cluster size at 10 and exposed only the cheap
result-time Number of topics projection. Number of topics can merge the
natural HDBSCAN Topics but cannot create finer natural leaves. Users also need
to tune that initial granularity for corpora whose stable density groups are
smaller or larger than the default.

## Decision

`TopicModelingAnalysisRequest.min_cluster_size` is a public initial-run
parameter with default 10 and minimum 2. The Topic Modelling parameter panel
labels it **Min topic size** and explains that it controls the smallest
number of Topic Segments that can form a natural HDBSCAN Topic.

The immutable Analysis request owns the value. Request hydration restores it,
and the worker forwards it unchanged to the native HDBSCAN fit. Changing it
requires submitting a new Analysis and therefore reruns segmentation,
embedding, PaCMAP, HDBSCAN, and downstream Result construction.

Result-time `cluster_count` remains a separate projection over the natural
leaves produced by that run. It never changes `min_cluster_size`, reruns
HDBSCAN, or splits above the run's natural Topic count.

This decision supersedes only ADR 0024's private fixed minimum-cluster-size
clause.

## Consequences

- The default behavior remains unchanged at 10.
- Smaller values can expose finer natural Topics but may produce noisier or
  less stable clusters; larger values require denser support for each natural
  Topic.
- Reopening an Analysis shows the exact initial-run value in the locked
  parameter panel.
- Cheap Number of topics and Top topics per document adjustments retain their
  existing projection and cache behavior.
