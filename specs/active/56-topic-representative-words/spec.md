# Topic Representative Words and Result Controls

Issue: [#56](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/56)

## Representative-word contract

- `polars-text` ranks a fixed 100 candidates for each topic by c-TF-IDF and
  emits `representative_words` as `{word, occurrence_count}` structs inside the
  scalar topic-modeling run result's complete `topics[]` list. Scores remain
  internal and are not duplicated in public parallel arrays.
- `occurrence_count` is the positive token count in the model Topic Segments
  assigned to the topic. Automatic segmentation overlap therefore contributes
  repeated occurrences. It is neither source-document frequency nor a
  source-position-deduplicated count.
- Topic Results remove `label` and expose only the structured representative
  words. Topic Analysis requests and Result metadata remove
  `representative_words_count`; Token Frequency requests remove the unused
  `stop_words` field.
- Compute-time stopword removal is removed. Topic stopwords are presentation
  state and never change an existing Result.

## Tab presentation contract

- Tabs own normalized `stop_words` for Token Frequency and Topic Modelling.
  Normalization trims and lowercases entries, removes empty values, and keeps
  the first occurrence of duplicates.
- Topic Modelling Tabs additionally own
  `topic_modeling_words_per_topic`. New Topic Tabs initialize it to 15; it is
  null for other Tab kinds and constrained to 3-100.
- Only explicit Tab PATCH requests mutate these settings. Submit, rerun,
  success, failure, cancellation, and Clear Results preserve them. Deleting a
  Tab deletes them with the Tab.
- The frontend patches optimistically without refetching the Result. A failure
  restores the last confirmed Tab state and presents a retryable error.
- Stopword enablement and detected language are transient frontend state. Both
  Token Frequency and Topic Modelling reset their switch off when a Result is
  hydrated. The Topic Modelling saved list remains visible and editable while
  filtering is off; its switch controls filtering only.

## Result projections

- Topic displays derive terms in this order: optional enabled-stopword filter,
  Words-per-topic slice, then representative-word search. A short result needs
  no warning.
- Words per topic lives in the Results control row and controls visual terms
  and representative-word search only.
- CSV retains one row per topic and exports the complete enabled-stopword-
  filtered candidate list as `word (count), ...`, ignoring the visual cap.
- Add to Workspace also ignores the visual cap and publishes the complete
  enabled-stopword-filtered list as strings. Already-created Data Blocks do not
  change when Tab settings later change.

## Stopword controls

- Token Frequency retains its textarea, Apply, Add Default, Sort, and
  right-click actions and adds an enable switch. Disabled editing preserves the
  saved list. Enabling immediately applies saved words.
- Topic Modelling exposes an enable switch, language action menu, and saved-list
  editor. Language detection begins only when the menu opens and samples the
  first selected Data Block.
- With no saved words, detection marks a recommendation but filtering waits for
  an explicit selection. The menu displays the saved-list count whenever that
  list is nonempty, even while filtering is off. Selecting a language replaces
  and persists exactly that bundled list; Clear stop words empties it. Both are
  actions and never change the filter switch. Language itself is never saved.
- The edit action is available with or without saved words. Its dialog accepts
  comma- or newline-separated words and saves the shared normalized form. Save
  waits for Tab PATCH confirmation; failure rolls back the Tab while preserving
  the draft for retry.

## Word clouds

- Token Frequency and Topic Modelling share a responsive presentational word-
  cloud primitive while retaining their feature-specific interaction wrappers.
- The Topic tooltip is hover-only and noninteractive, replaces its comma list,
  sizes terms by `occurrence_count`, provides accessible word/count text, and
  clamps or flips at chart edges.
- Ordering communicates c-TF-IDF distinctiveness; cloud size communicates
  model-segment occurrence count.

## Compatibility and rollout

- `polars-text` source metadata becomes 0.5.0 and the backend requires
  `polars-text>=0.5.0`.
- Native Workspace schema 17 and archive format 16 strictly reject older
  versions. No adapter or migration is provided.
- Package publication is deferred. Editable-workspace verification is the
  delivery gate; the standalone backend change remains blocked until 0.5.0 is
  published, with no compatibility fallback.

## Non-goals

- Tokenizer alignment tracked by #40.
- Source-position occurrence deduplication.
- Public c-TF-IDF scores.
- Interactive tooltip clouds.
- Topic reduction.
