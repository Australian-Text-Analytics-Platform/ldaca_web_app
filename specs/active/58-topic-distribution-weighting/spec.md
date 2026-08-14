# Topic Distribution Weighting

Issue: [#58](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/58)

## Pipeline contract

- Automatic, Paragraph, and Sentence modes differ only in Topic Segment
  construction. All modes share embedding, PaCMAP, HDBSCAN, c-TF-IDF,
  length-weighted document rollup, and Result construction.
- Every retained Topic Segment is one equal clustering observation. Minimum
  topic size therefore counts Topic Segments.
- Document rollup weights a segment by the Unicode-character length of its
  retained text. Automatic overlap counts repeated observations. Outliers stay
  in the normalization denominator.
- Dominance selects the highest-weight real topic, breaks ties by smaller topic
  ID, and uses `-1` only when no real topic exists.
- Bubble sizes and `total_size` remain integer dominant-document counts.

## Native and backend contract

- `polars_text.topic_modeling` is scalar and non-elementwise. It returns one
  run result with independent `documents[]`, complete `topics[]`, `n_chunks`,
  `truncated_segment_count`, and `stage_timings_ms`.
- The native contract does not replicate topic metadata onto document rows and
  has no redundant `n_topics` or unused corpus-size fields.
- Backend Result storage and HTTP schemas are unchanged. The backend validates
  contiguous topic IDs, exact document indices, unique distribution entries,
  and topic references, then pads every distribution in canonical order.

## Compatibility

- Existing materialized Results are not rewritten. New runs and reruns use the
  new semantics.
- Native Workspace schema 17 and archive format 16 remain unchanged because
  their stored Result contract does not change.
- The redesign ships inside the unreleased `polars-text` 0.5.0 boundary without
  a legacy native-output adapter.
