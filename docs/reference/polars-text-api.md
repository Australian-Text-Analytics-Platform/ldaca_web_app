# polars-text API Reference

Version 0.6 requires Python Polars 1.44.1. Importing `polars_text` registers the
sole expression façade, the `.text` namespace. The namespace registers native
plugins against the exact imported `_internal` extension; `clean_text` and
`char_count` are native Polars expression compositions.

## Expression Namespace

```python
expr.text.tokenize(
    *, model, lowercase=True, remove_punctuation=True, cache=None
)
expr.text.concordance(
    query, *, left_tokens=5, right_tokens=5, regex=False,
    case_sensitive=False, ignore_punctuation=False
)
expr.text.embedding(*, model=None, cache=None, batch_size=None)
expr.text.topic_modeling(
    *, embedding_model=None, embedding_cache=None,
    segmentation="automatic", max_tokens=256, seed=42,
    min_topic_size=10, tokenizer_model=None, lowercase=True
)
expr.text.clean_text()
expr.text.word_count()
expr.text.char_count()
expr.text.sentence_count()
```

Tokenization returns `List[Struct[token: String, start: Int64, end: Int64]]`
with Unicode character offsets. Model IDs use the `native:`, `huggingface:`, or
`lindera:` namespace. `word_count` and `sentence_count` follow Unicode UAX #29.

Concordance always slices contexts from the original source text, preserving
its punctuation and whitespace. `ignore_punctuation` changes which tokens count
toward the left and right window and L1/R1, not matching or returned text.

Topic segmentation accepts `automatic`, `line`, or `sentence`. Every mode emits
non-overlapping source spans. Oversized semantic units are subdivided on Unicode
and token boundaries without discarding tail text. `max_tokens` includes any
special tokens added by the embedding model.

The default embedder is `sentence-transformers/all-MiniLM-L6-v2`. Its Sentence
Transformers metadata declares a 256-token maximum, which both the namespace
and Wordflow enforce. Cache paths are dedicated disposable storage and may be
replaced completely when their schema or model-pipeline fingerprint changes.

The scalar topic result is:

```text
{
  documents: [{doc_index, dominant_topic, topic_coverage}],
  topics: [{id, representative_words, x, y}],
  n_segments,
  projection_context
}
```

Topic Coverage is weighted by the source-character length owned by each Topic
Segment. Outlier `-1` competes normally for dominance. Clustering still treats
each segment as one observation. When the corpus cannot support a real HDBSCAN
Topic, `topics` is empty and `projection_context` is null. Otherwise the context
is compressed MessagePack used by supported projectors without rerunning
embedding or HDBSCAN.

## Whole-Series Utilities

- `token_frequencies(series, model=...)`
- `token_frequency_stats(corpus_0, corpus_1)`
- `project_topics(projection_context, topic_count)`
- `project_topic_basis(projection_context, topic_count, corpus_sizes)`

`project_topics` returns projected `documents` and `topics` for any count from
one through the natural real-Topic count.
`project_topic_basis` returns topic metadata plus sorted
`[corpus_index, topic_id, minimum_n, count]` activations.

The immutable tokenizer catalogue is `TOKENIZER_MODELS`, a tuple of
`TokenizerModel(model_id, label, languages)` records. Registry prefetch and
loaded-model inspection are not public APIs.

Serialized-plan path functions belong to `polars_source_utils`.
