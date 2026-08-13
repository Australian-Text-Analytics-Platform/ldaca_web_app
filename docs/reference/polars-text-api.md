# polars-text API Reference

Importing `polars_text` registers the `.text` namespace on Polars expressions.
Plugin wrappers resolve the exact imported `_internal` extension file so an
editable environment cannot load a stale ABI sibling.

## Expression API

- `clean_text(expr)`
- `word_count(expr)`
- `char_count(expr)`
- `sentence_count(expr)`
- `concordance(expr, search_word, num_left_tokens=5, num_right_tokens=5, regex=False, case_sensitive=False, remove_punct=False)`
- `embedding(expr, ...)`
- `topic_modeling(expr, ...)`
- `pl.col("text").text.tokenize(model=..., lowercase=..., remove_punct=..., cache=...)`

Tokenization returns `List[Struct[token: String, start: Int64, end: Int64]]`
with Unicode character offsets. Supported model namespaces are `native:`,
`huggingface:`, and `lindera:`. A cache path enables the Rust-owned DuckDB
cache; `None` computes directly.

`concordance(..., remove_punct=True)` excludes tokens containing no Unicode
alphanumeric characters when selecting left/right context and L1/R1. Context
strings are sliced from the original text offsets, so punctuation and
whitespace between retained tokens and the match remain visible. Match
selection itself is unchanged.

Embedding accepts string or list-of-string input and returns a vector or nested
vectors per row. `topic_modeling` is a whole-column expression that returns one
result struct per source document. Its segmentation arguments are:

- `segmentation_method`: `"automatic"`, `"paragraph"`, or `"sentence"`;
- `max_tokens`: maximum model tokens per Topic Segment; and
- `overlap`: the automatic-mode overlap. Paragraph and Sentence modes ignore
  overlap, preserve semantic units, and right-truncate units over `max_tokens`.

The result includes `n_chunks` and `truncated_segment_count` as replicated
run-level fields. `n_chunks` retains its lower-level name but counts Topic
Segments. `representative_words` is a list of
`{word: String, occurrence_count: UInt64}` structs, fixed at at most 100 terms
in descending c-TF-IDF order. Counts are over assigned model Topic Segments, so
automatic overlap can count the same source text more than once. Stopwords and
display limits are not expression arguments.

## Direct Functions

- `token_frequencies(series, model=...)` returns a token-count dictionary.
- `token_frequency_stats(corpus_0, corpus_1)` returns comparative statistics.
- `prefetch_model(model)` and `list_loaded_models()` access the tokenizer
  registry.
- `PREDEFINED_MODELS` and `LINDERA_MODELS_BY_LANGUAGE` expose inventory, not
  product recommendation policy.

Serialized plan path functions are provided by `polars_source_utils`, not
`polars_text`.
