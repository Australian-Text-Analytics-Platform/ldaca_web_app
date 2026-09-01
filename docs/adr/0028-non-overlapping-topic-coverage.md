---
status: accepted
---

# Non-overlapping Topic Coverage and cosine projection

## Context

Topic Segments previously overlapped in Automatic mode and discarded the tail
of oversized explicit units. The repeated or missing text made document shares
hard to interpret as source coverage. Small corpora were also forced into a
synthetic Topic, while Result-time Ward merges used PaCMAP coordinates rather
than the model's original semantic space.

## Decision

Every Topic Segment is a trimmed, non-overlapping source span. Automatic mode
tokenizes each document once and chooses the latest blank-line, Unicode UAX #29
sentence, word, or token boundary within the model-token budget. Line mode
starts from each trimmed non-empty newline-delimited line, and Sentence mode
starts from UAX #29 sentences. Oversized Line and Sentence units are
recursively split within the same budget. No mode overlaps text or discards an
oversized unit's tail.

Each segment remains one equal observation for PaCMAP and HDBSCAN. A corpus
with fewer than `max(3, min_topic_size)` segments, or whose HDBSCAN result is
all noise, returns no real Topics. Its documents retain explicit outlier
coverage, and it has no projection context or projection Artifact.

Document **Topic Coverage** weights each segment by the Unicode-character count
of its owned source span. Outlier `-1` stays in the denominator and competes
normally for dominance. An exact coverage tie selects the smaller Topic ID, so
`-1` wins a tie with Topic `0`.

The version-2 projection context stores additive original-embedding sums for
natural Topics. It builds a deterministic cosine average-linkage hierarchy in
that semantic space, giving each natural Topic equal merge weight. Projection
supports one through the natural real-Topic count. One projected Topic is
placed at the origin, two are placed symmetrically by cosine distance, and
three or more merged Topic centroids receive one seeded two-dimensional PaCMAP
layout. Segment embeddings are reduced only once for the HDBSCAN fit; there is
no separate all-segment visualization reduction.

This decision supersedes the overlap, truncation, dominant-real-Topic, Ward,
five-dimensional projection, two-Topic lower-bound, and explicit-default-query
clauses in ADRs 0019, 0023, 0024, and 0025. It changes the semantic Arrow type
to `org.ldaca.wordflow.topic_coverage.v1` with `{topic_id, coverage}` entries.
This decision originally advanced native Workspace schema 23 and portable
archive format 22. The later granular-versioning clean break rejects both and
stores this Topic Modelling contract under data schema 1, Topic Modelling
schema 1, and archive data format 1.

## Consequences

- Coverage has a direct source-text interpretation and representative-word
  counts no longer double-count overlap.
- Long Line and Sentence units retain all modelled text at the cost of creating
  additional equal clustering observations.
- Very small or density-free corpora report uncertainty instead of a fabricated
  Topic; projection and Add to Workspace are unavailable for that result.
- Result-time merges follow semantic cosine similarity, independent of PaCMAP's
  clustering geometry and population imbalance between natural Topics.
- Changing only to an already-stored natural/default projection does not read or
  recompute the projection context.
