---
status: accepted
---

# Adjustable Topic Cluster Projections

## Context

Topic Modelling previously exposed HDBSCAN's minimum cluster size as a run
parameter. Users could influence clustering only by rerunning the complete
embedding pipeline, and the parameter did not provide a predictable number of
Topics. Result-time adjustment must preserve immutable Analyses, outlier
semantics, representative words, document distributions, and Add to Workspace
outputs without retaining source text or high-dimensional embeddings.

## Decision

HDBSCAN uses the private fixed minimum cluster size 10. Its real Topics are
maximum-resolution leaves and outlier `-1` remains outside the merge process.
After the natural fit, `polars-text` builds a deterministic weighted Ward tree
over the real leaf centroids in five-dimensional PaCMAP space.

The Analysis persists one versioned, zstd-compressed MessagePack clustering
context. It contains the Ward merges and only the additive facts needed to cut
the tree and rebuild a Result: leaf centroids and segment counts, vocabulary
and sparse term counts, two-dimensional coordinate sums, document/source-row
identity, retained-character weights, corpus membership, and outlier mappings.
It excludes source text, 384-dimensional embeddings, HDBSCAN internals, and
per-cluster-count Results.

The existing side-effect-free Result-query endpoint accepts an optional
`cluster_count`. A null value selects the canonical stored natural fit, while
every explicit value, including the natural count, runs the projector from the
immutable context. Supported counts range
from the natural real-Topic count down to two; Results with at most two real
Topics have a fixed control. Every tree cut reassigns real Topic IDs
contiguously by smallest descendant leaf ID and recomputes c-TF-IDF words,
coordinates, dominant Topics, per-corpus document counts, and
retained-character-weighted distributions. Outlier weight is unchanged and
remains in each distribution denominator.

The immutable stored Result is the natural projection produced by the same
projector. A successful non-default selection may be remembered separately on
the Tab. Topic Modelling Data Block Creation names the displayed cluster count
and reruns the projector against the parent's immutable context and input
snapshot before materializing assignment and meaning tables.

## Consequences

- Moving the Result control does not rerun embedding, reduction, or HDBSCAN and
  does not mutate the Analysis, stored Result, Artifacts, or Workspace revision.
- Projected Results are not retained as reusable frontend cache entries or
  backend per-count Artifacts. Each changed slider release is one explicit
  projection attempt.
- The slider can merge Topics but cannot split above HDBSCAN's natural fit.
- Projection time and storage scale with the natural leaves and sufficient
  statistics rather than all pairwise Topic Segments or 384-dimensional vectors.
- Public Results contain authoritative Topic JSON and ordered source metadata;
  assignment and meaning tables exist only when Add to Workspace publishes
  Derived Data Blocks.
- Missing context is an unavailable Artifact, while an invalid context or
  unsupported context version makes the owning Analysis corrupt.
- Native Workspace schema 18 and portable archive format 17 reject older
  layouts without runtime migration.
