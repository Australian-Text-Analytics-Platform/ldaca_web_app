---
status: accepted
---

# Top-N Topic Membership Projections

## Context

Document Topic Distributions already retain positive shares for Topics that do
not dominate a row. Dominant-only bubble counts hide those Topics and can show
a valid Topic detached with zero documents. Users need to adjust how many
ranked Topics per row contribute to bubbles without rerunning the model or
rebuilding the same K projection for every N.

## Decision

For a projected real-Topic count K, a row activates every positive real Topic
whose share is among its Top N values. Outlier `-1` and zero shares never
activate a real-Topic bubble. Ties use the same rank: a Topic's minimum N is one
plus the number of strictly higher positive shares. This includes every tie at
the cutoff and permits totals across bubbles to exceed the number of rows.

The immutable clustering context remains the projection source. For each K the
native projector builds a complete N-independent basis containing Topic
metadata and aggregated `(corpus, topic, minimum N, count)` activations. It does
not serialize per-row distributions into Python for a Result query. A
runtime-owned, thread-safe, single-flight LRU caches only the compact encoded
basis, keyed by principal, Workspace, Analysis, immutable context-file
identity, and K. N is not part of the key, and no per-N Result is retained.
Entry and byte limits are operator settings; zero disables retention and
oversized values remain usable for their current response.

The canonical stored Result uses default `min(2, K)`. Any explicit K or N,
including an explicit default, uses the basis path. A Tab may remember the last
successful `(Analysis, K, N)` pair, while null represents both defaults.

Topic Data Block Creation uses the displayed K and N. Selected bubbles publish
the union of rows that activate any selected Topic. The dominant `TOPIC_top1`
and complete Topic Distribution remain unchanged, and meanings include every
Top-N Topic represented in the published rows.

This decision supersedes ADR 0023's dominant-only bubble-size clause and ADR
0024's dominant document-count and no-backend-cache clauses. ADR 0024's
immutable Ward projection, no per-count Artifact, and Result-attempt lifecycle
remain in force.

## Consequences

- Bubble counts express membership, not mutually exclusive assignment. One row
  can contribute to multiple bubbles and cutoff ties can contribute to more
  than N.
- Changing N sends a fresh Result query but reuses the complete K basis when it
  remains cached. Changing K or immutable context identity rebuilds the basis.
- The natural analysis aggregates the complete distributions it already owns;
  Data Block Creation remains the only projected path that requests complete
  row distributions from the native context.
- N-only frontend updates retain graph layout and interaction state; K changes
  still reset and refit the graph.
- Native Workspace schema 20 and portable archive format 19 reject older
  layouts without runtime migration.
