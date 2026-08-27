# Top Topics per Document for Topic Bubbles

Issue: [#61](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/61)

## Result contract

- Every Topic Result exposes `topic_inclusion` with the applied, minimum,
  maximum, default, and adjustable Top-N values. Empty Results use 0,
  one-Topic Results use 1, and larger Results default to 2 with bounds 1..K.
- A real Topic counts a source row when its positive Topic Distribution share
  is among that row's Top N real-topic shares. Outlier `-1` and zero shares do
  not count. Every tie at the cutoff counts, so one row may activate more than
  N bubbles.
- Canonical stored Results use the natural K and default Top N. An explicit
  `cluster_count` or `top_n_topics`, including an explicit default, reads the
  immutable clustering context and derives a fresh Result. Null for both reads
  the canonical stored Result unchanged.

## Projection basis and cache

- One N-independent basis contains every projected Topic and aggregated
  `(corpus, topic, minimum N, count)` activations. Minimum N is one plus the
  number of strictly higher positive real-topic shares.
- Explicit Result queries aggregate that basis inside the native projector and
  serialize no per-row distributions into Python. The natural analysis reuses
  the complete distributions already returned by its one native run.
- The runtime owns a thread-safe, single-flight LRU keyed by user, Workspace,
  Analysis, immutable context-file identity, and K. It stores compact basis
  bytes only and never stores per-N Results.
- `MAX_TOPIC_PROJECTION_CACHE_ENTRIES` defaults to 16 and
  `MAX_TOPIC_PROJECTION_CACHE_BYTES` defaults to 67108864. Zero disables the
  cache. Oversized bases serve the current request without retention; failed
  or invalid projections are not cached.
- Sparse complete distributions remain inside the natural native result or the
  Data Block projector until Topic Data Block Creation pads them into the
  fixed-size Arrow extension representation.

## Interface, persistence, and publication

- `TopicModelingResultQuery.top_n_topics` is nullable. Invalid values return
  422 `invalid_topic_top_n` with the current bounds.
- Topic Result queries return every projected Topic in one response. They do
  not expose page or page-size controls.
- Topic Data Block Creation captures K and Top N in its request and
  provenance. Selected Topics publish the union of rows whose Top-N membership
  intersects the selection, without duplicate rows. No selection retains all
  rows.
- `TOPIC_top1` remains the dominant Topic and `TOPIC_distribution` remains
  complete. The meanings Data Block includes every Top-N Topic represented by
  the published rows, including selected non-dominant Topics.
- A Tab owns one nullable `topic_modeling_projection_selection` containing the
  successful Analysis ID, K, and Top N. Null represents both defaults. A new
  successful Analysis starts at natural K and default Top 2.
- Native Workspace schema 20 and archive format 19 strictly reject older
  layouts without migration.

## Frontend behavior

- **Top topics per document** is a number input. Enter or blur commits one distinct
  value; partial input and recommitting the applied value send no request.
- Lowering K below N commits one combined request with N clamped to K.
- Result attempts use the complete `(K, N, request key)` identity. Graph layout
  uses `(Analysis, K)` only. N-only updates keep selection, search, lasso,
  viewport, hover identity, and an open Add to Workspace dialog while updating
  counts, bubble radii, lists, CSV values, and tooltips.
- Cluster changes retain the existing reset and refit behavior. Tooltip state
  stores only a Topic ID and resolves the latest Topic payload.
- Help text states that rows may count toward multiple bubbles and cutoff ties
  may include more than N Topics.
