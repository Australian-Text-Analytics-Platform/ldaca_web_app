# Topic Modelling Segmentation

Issue: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/23

Status: Completed 2026-08-06.

## Required behavior

- Topic Modelling exposes one Analysis-wide Segmentation method: Automatic,
  Paragraph, or Sentence.
- Topic Modelling exposes a Maximum tokens per segment value from 32 to 510,
  defaulting to 256.
- A Topic Segment is the text unit embedded, clustered, and used for c-TF-IDF
  representative-word extraction.
- Automatic preserves hierarchical packing, uses Unicode UAX #29 sentence
  boundaries, and scales hidden overlap to one eighth of the token cap with a
  maximum of 32 tokens.
- Paragraph treats each non-empty newline-delimited line as one Topic Segment.
- Sentence treats each Unicode UAX #29 sentence as one Topic Segment.
- Paragraph and Sentence never overlap or subdivide a semantic unit. Oversized
  units retain only their first configured number of model tokens.
- Successful Results report how many Topic Segments were truncated and the
  frontend warns when that count is non-zero.
- Saved Analyses restore and lock the configuration. Clear Results preserves
  the values and unlocks them.

## Non-goals

- Fixed-length segmentation as a user-selectable method.
- Per-Data-Block segmentation settings.
- A Topic Segment preview or inspector.
- Adding segmentation metadata to chart or CSV downloads.
- A legacy sentence-boundary compatibility mode for reruns.
