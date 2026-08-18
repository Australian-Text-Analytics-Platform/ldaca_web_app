# Adjustable Topic Clusters

Issue: [#62](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/62)

## Product contract

- Topic Modelling no longer exposes Minimum topic size as an Analysis input.
  New runs use HDBSCAN with the internal fixed value `min_cluster_size = 10`.
- HDBSCAN real Topics are the maximum-resolution leaves. The Result control can
  merge them down to two real Topics but cannot split above the natural count.
  Outlier `-1` remains separate and does not count toward the selected number.
- Results with zero, one, or two real Topics expose their fixed count in a
  disabled Number of clusters control.
- An Analysis and its canonical Result remain immutable. A successful
  non-default selection is stored only as the owning Tab's presentation
  setting. A new successful Analysis starts from its natural count.

## Projection contract

- `polars-text` prepares a versioned clustering context and derives the natural
  Result through the same projector used by later Result queries.
- The zstd-compressed MessagePack context stores natural leaves, their 5-D
  centroids and segment counts, a deterministic weighted Ward merge tree,
  vocabulary and sparse per-leaf term counts, 2-D coordinate aggregates,
  document mappings, retained-character weights, and outlier membership.
- The context does not store source text, 384-D embeddings, HDBSCAN internals,
  or per-count Results.
- Every cut reassigns real Topic IDs contiguously from zero by smallest
  descendant leaf ID and recomputes representative words, c-TF-IDF,
  coordinates, dominant Topics, per-corpus counts, and retained-character-
  weighted Topic Distributions. Outlier weight remains in the denominator.

## Public interfaces and lifecycle

- `TopicModelingResultQuery.cluster_count` is nullable; null selects the natural
  count. The Result publishes ordered `sources[]` and a `clustering` descriptor
  containing the applied, minimum, maximum, default, and adjustable values.
- Invalid counts return 422 with current bounds. A missing declared context
  returns 410, while invalid versions or corrupt content mark the Analysis
  corrupt.
- Public Results contain authoritative projected Topic JSON rather than
  assignment or meaning Artifact URLs.
- Topic Data Block Creation requires the displayed `cluster_count`, reruns the
  projector against the parent's immutable context and input snapshot, and
  materializes matching assignment and meaning tables only for the child.
- The client owns one pointer transaction around the controlled Radix slider.
  Movement updates only the visible draft, a normal release commits the latest
  draft exactly once, and pointer cancellation, lost capture, or window blur
  restores the applied count without a request. Keyboard adjustments commit
  immediately. Every committed count other than the applied count creates one
  request attempt keyed by Analysis and a monotonically increasing client-only
  request key; committing the applied count is a no-op.
- Projection attempts use no reusable TanStack cache, propagate cancellation,
  and keep the previous graph and Topic list mounted but inert under an updating
  overlay. The panel unlocks only when the matching non-placeholder Result is
  installed and its React Flow nodes have been measured and fitted, with no
  artificial minimum lock duration. Failure restores the applied thumb position
  and Retry creates a fresh attempt.
- Each successful attempt resets result interactions and issues at most one Tab
  presentation PATCH. An explicit `cluster_count`, including the natural count,
  runs the projector; only null may return the canonical stored Result. Neither
  frontend nor backend stores per-count projected Results.
- A successful count change resets Topic selection, hover, tooltip, zoom, and
  an open Add dialog while retaining search, stopwords, and words-per-topic.

## Graph interaction contract

- The Topic graph is a non-editable React Flow plane. Its initial view, Fit View,
  container resize while fitted, and every new projection include every complete
  bubble; intentional pan or zoom may move Topics outside the viewport.
- Drag pans the graph and wheel or pinch gestures zoom it. Horizontal React Flow
  controls own zoom in, zoom out, Fit View, additive lasso, and download.
- Lasso mode uses an application-owned freehand canvas transaction and remains
  active until toggled off. A completed polygon adds every Topic whose centre is
  inside it to the existing lasso filter; cancellation and empty hits are no-ops.
- The additive lasso filters All Topics in conjunction with representative-word
  search but does not alter manual Topic selection, Add to Workspace, or complete
  CSV membership. Projection changes clear the filter.
- Image exports reproduce the current React Flow viewport without toolbar,
  tooltip, or an in-progress lasso path.

## Compatibility

- Native Workspace schema 18 and portable archive format 17 are strict current
  versions. Older versions are rejected without migration.
- The context Artifact participates in normal Analysis cleanup and archive
  round trips.
