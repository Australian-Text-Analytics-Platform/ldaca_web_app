---
status: accepted
---

# Length-Weighted Topic Distributions

The distribution name, overlap weighting, and dominance clauses are superseded
by [ADR 0028](0028-non-overlapping-topic-coverage.md).

## Context

Topic Modelling clusters Topic Segments but presents results for source
documents. Counting every segment equally makes a short sentence contribute as
much document-level topic mass as a long retained paragraph. Automatic
segmentation can also repeat text through overlap. Topic metadata was formerly
replicated only onto documents dominated by that topic, which lost any topic
that appeared in distributions but never dominated a document.

## Decision

Automatic, Paragraph, and Sentence segmentation differ only in Topic Segment
construction. Every segment remains one equal embedding and HDBSCAN observation.

The document rollup separately weights each Topic Segment by the Unicode scalar
count of its retained text after any truncation. Automatic overlap contributes
each repeated observation. Outlier weight remains in the denominator so every
non-empty document distribution sums to approximately one. The highest-weight
real topic is dominant, with the smaller topic ID winning a tie. Outlier `-1`
is dominant only when the document contains no real-topic segment.

The native expression returns one scalar run result with independent,
complete `documents[]` and `topics[]` lists. Bubble sizes remain integer counts
of documents by dominant topic rather than segment mass or fractional topic
proportions.

## Consequences

- Segment length affects document-level topic proportions and dominance but not
  the equal-observation HDBSCAN fit or Ward merge weights.
- Unicode text is not biased by UTF-8 byte width.
- Explicit-mode truncation changes weight because discarded tail text is not
  modelled.
- Automatic overlap deliberately counts repeated source text in rollup and
  representative-word occurrence counts.
- Topics remain available to Result construction even when none is dominant.
- The native contract changes before the unreleased `polars-text` 0.5.0
  boundary; no compatibility adapter or artifact migration is retained.
