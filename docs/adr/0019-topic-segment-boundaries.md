---
status: accepted
---

# Topic Segment Boundaries

The overlap and truncation clauses are superseded by
[ADR 0028](0028-non-overlapping-topic-coverage.md).

## Context

Topic Modelling embeds bounded text spans rather than whole source documents.
The boundary policy materially changes which context reaches the embedding
model, but it was previously fixed inside the native pipeline and invisible to
users. Silent model-token truncation also made deliberate paragraph or
sentence boundaries difficult to reason about.

## Decision

The product calls the embedded and clustered unit a **Topic Segment**. A Topic
Modelling Analysis request owns one global segmentation method and one maximum
token count, shared by every selected Data Block.

Automatic segmentation hierarchically splits blank-line blocks, Unicode UAX
#29 sentences, and token-length units, then packs them with an overlap of one
eighth of the token cap, bounded at 32 tokens. Paragraph segmentation treats
each trimmed non-empty newline-delimited line as one semantic unit. Sentence
segmentation uses Unicode UAX #29 sentence boundaries.

Paragraph and Sentence units are never subdivided or overlapped. If a unit is
over the cap, only its first configured number of tokenizer tokens is retained.
The Result records the truncation count so the interface can disclose lost
tail text. Version 0.6 standardizes the lower-level names as `TopicSegment` and
`n_segments` so implementation and product vocabulary agree.

## Consequences

- Users can choose boundaries that match the structure of their source text.
- Automatic mode remains the default and preserves broad prior behavior while
  using a standard Unicode sentence boundary implementation.
- Explicit semantic modes prefer boundary integrity over retaining all text;
  truncation is visible after the run.
- Rerunning an older Analysis may produce different sentence boundaries because
  no compatibility sentence splitter is retained.
