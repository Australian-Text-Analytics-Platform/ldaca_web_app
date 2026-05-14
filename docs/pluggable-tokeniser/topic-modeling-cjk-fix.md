# Topic Modelling for CJK — Label-Stage Multilingual Fix

**Branch:** `multilingual` (root + `backend/`)
**Status:** landed; JA now also has working tokenisation via Phase 5 (Lindera) — see [Update 2026-05-14](#update-2026-05-14--ja-tokenisation-now-actually-works) at the bottom.
**Scope:** backend only (no frontend or API contract changes)
**Follow-up to:** Phase 3.5 in [PLAN.md](./PLAN.md)

---

## TL;DR

BERTopic on a tokenised Chinese (or any non-English) corpus now produces
**meaningful topic labels** instead of character-blob garbage. The fix has
three parts, all in [backend/src/ldaca_web_app/core/worker_tasks_topic.py](../../backend/src/ldaca_web_app/core/worker_tasks_topic.py):

1. The **classic pipeline** (default for typical corpus sizes) now attaches a
   language-aware `CountVectorizer` to BERTopic. Previously it passed none,
   which silently defaulted to `CountVectorizer(stop_words="english")` with
   the `\b\w\w+\b` regex — that regex cannot segment CJK because there are
   no `\b` boundaries between Han ideographs.

2. We feed BERTopic the **pre-tokenised, space-joined derived tokens
   column** as the `docs` argument to `fit_transform`. Embeddings are still
   computed from the raw text column (cache-stable, sentence-transformer
   gets natural input). The vectorizer's job becomes trivial: split on
   Unicode word characters.

3. `BERTopic(language="multilingual")` is now passed explicitly when the
   resolved language ≠ `"en"`. This was missing entirely before.

## Why the old behaviour broke

The chain that produced bad Chinese topic labels:

| Stage | Old behaviour | Problem for ZH |
|---|---|---|
| Embedding model | Routed by `effective_language` → `paraphrase-multilingual-MiniLM-L12-v2` for ZH (✓ correct after Phase 3.1) | None — embeddings were already fine. |
| Clustering (UMAP + HDBSCAN) | Operates on embeddings | None — language-agnostic. |
| **c-TF-IDF / label stage** | Classic pipeline: no `vectorizer_model` → BERTopic falls back to `CountVectorizer(stop_words="english")` with `token_pattern=r"(?u)\b\w\w+\b"` | `\b` between two CJK ideographs is *not* a boundary, so the regex matches the entire contiguous Han run as one giant "word". Every Chinese document collapses to a single token in c-TF-IDF → degenerate topic labels. |
| `BERTopic(language=...)` | Never set → defaulted to `"english"` | Skews some of BERTopic's internal heuristics toward English defaults even when the embedder is multilingual. |

The online pipeline got a partial fix in Phase 3.5 — its
`OnlineCountVectorizer` already dropped the English stoplist for non-English
— but the default `token_pattern` still couldn't segment CJK, and the
classic pipeline (which is what most users hit) was completely untouched.

## Design choices and why

### 1. Pre-tokenise the **vectorizer docs**, not the **embedder docs**

We had three viable paths for "make c-TF-IDF see Chinese words":

| Option | Pros | Cons |
|---|---|---|
| **A.** Custom `tokenizer=lambda x: jieba.cut(x)` on `CountVectorizer` | One column suffices | Lambdas don't pickle. Breaks the exact-mode reduction artifact (`_persist_exact_reduction_artifact`) which `pickle.dump`s the BERTopic model. Also re-runs jieba at label time when we already tokenised earlier. |
| **B.** Pass space-joined tokens to *both* embedder and vectorizer | Simplest plumbing | **Wrong** — sentence-transformers (`paraphrase-multilingual-MiniLM-L12-v2`) have their own SentencePiece tokenizer trained on natural-language input. Pre-spaced CJK shifts the tokenization away from what the model was trained on; embeddings degrade. |
| **C. (chosen)** Embed from raw text; pass space-joined tokens as the `docs` argument to `fit_transform` so only the vectorizer sees them | Embedding quality preserved. Vectorizer becomes trivial (`\b\w+\b`). Pickle-safe. Reuses the existing `__derived__.tokens.*.*` column produced by the Tokenise dialog — no duplicate work. | Slightly more state in the worker (two parallel doc lists). Out-of-band visualisations that read `topic_model.representative_docs_` will see joined tokens rather than original strings (not currently surfaced in the API). |

BERTopic's API permits exactly this split: `fit_transform(docs, embeddings)`
uses `embeddings` for clustering and uses `docs` only for the vectorizer/
c-TF-IDF stage. So passing pre-computed embeddings means the `docs`
argument never reaches the embedder.

### 2. `token_pattern=r"(?u)\b\w+\b"`, not `tokenizer=split`

The reference code we received used:

```python
CountVectorizer(tokenizer=lambda x: x.split(" "), token_pattern=None, ...)
```

We use:

```python
CountVectorizer(token_pattern=r"(?u)\b\w+\b")
```

Both produce equivalent output on space-joined tokens, but the regex form
has two advantages:

- **Pickle-safe.** The vectorizer is a plain sklearn object with serialisable
  fields. The exact-mode reduction path (`_persist_exact_reduction_artifact`
  in [worker_tasks_topic.py:308](../../backend/src/ldaca_web_app/core/worker_tasks_topic.py#L308)) pickles the BERTopic model so the user can re-aggregate
  topics without refitting; a lambda tokenizer would break that.
- **Punctuation-tolerant.** If a token happens to include a trailing
  punctuation glyph (Chinese full-width `。` or `，`), `\b\w+\b` still
  extracts the inner word run, whereas `x.split(" ")` would keep the
  punctuation glued.

The `(?u)` flag puts the regex in Unicode mode so `\w` matches CJK
ideographs (Han, Hiragana, Katakana, Hangul) as well as Latin word
characters.

### 3. No backend stopwords for non-English. Period.

Per explicit user instruction recorded in the multilingual fix discussion:

> The Chinese stop_words MUST NOT be applied at the tokenisation stage.
> Once the topic is formed, the user can choose to apply stopwords to
> remove meaningless contents from each topic (also remove empty topic
> if it's full of stopwords, purely frontend), or not.

Backend rationale: a backend-injected CJK stopword list is opinionated and
hard to audit. Two users on the same corpus would see the same topic
labels regardless of whether 的 / 是 / 了 are interesting to *their*
research question. Putting the filter in the frontend keeps the topic
output reproducible and lets the user interactively prune meaningless
words and collapse empty topics.

Implementation consequence: `_build_label_vectorizer(language, online=...)`
returns `CountVectorizer(token_pattern=r"(?u)\b\w+\b")` for non-English
with **no** `stop_words=` argument. English keeps `stop_words="english"`
for backward compatibility (existing English flows are byte-identical).

### 4. Raw-text fallback when no derived tokens exist, with a signal for the UI

If the user runs topic modelling on a Chinese column they never
tokenised, we don't currently have a segmenter to fall back to inside the
worker. We don't want to:

- Block the run (would surprise English users who have always run on
  raw text).
- Auto-tokenise inline (heavy dependency in the worker, hides what the
  pipeline is doing from the user).

So the worker **silently falls back to raw text** (matching pre-fix
behaviour) and surfaces a signal so the **frontend can prompt the user
next time**. The signal lives in `result.meta.language_resolution`:

```jsonc
{
  "language": "zh",
  "bertopic_language": "multilingual",
  "label_vectorizer_mode": "raw_text_fallback",   // or "pretokenised" / "pretokenised_mixed" / "english_default"
  "nodes": [
    {
      "node_id": "abc-123",
      "text_column": "document",
      "tokens_column": null,                       // or "__derived__.tokens.document.jieba"
      "label_source": "raw_text"                   // or "pretokenised"
    }
  ]
}
```

The planned (not yet implemented) UX is a pre-run popup with three
options:

| Option | Behaviour |
|---|---|
| **Cancel** | Drop the run. |
| **Tokenise then proceed** | Open the Tokenise dialog with the column preselected; on success, auto-run topic modelling. |
| **Proceed with raw text** | Run anyway (the silent fallback, but acknowledged). |

The frontend can decide which option to surface by:
- Reading `node.derived` for the selected column (already passed through
  to ReactFlow data via [useWorkspaceGraph.ts](../../frontend/src/features/workspace/graph-view/hooks/useWorkspaceGraph.ts)) before submitting the run, so the prompt can fire pre-run; **or**
- Reading `result.meta.language_resolution.label_vectorizer_mode` after a
  run completes and showing a "labels may be degraded — re-tokenise to
  improve" banner.

No additional backend endpoint or field is required.

## Implementation map

All changes in [backend/src/ldaca_web_app/core/worker_tasks_topic.py](../../backend/src/ldaca_web_app/core/worker_tasks_topic.py):

| Symbol | Role |
|---|---|
| `_bertopic_language_kwarg(language)` | Maps internal language code (`"en"`, `"zh"`, ...) to BERTopic's `language=` kwarg (`"english"` / `"multilingual"`). |
| `_build_label_vectorizer(language, *, online)` | Returns the right `CountVectorizer` / `OnlineCountVectorizer` for the language. English: sklearn's English stoplist + default regex. Non-English: `token_pattern=r"(?u)\b\w+\b"`, no stopwords. |
| `_build_classic_pipeline(...)` | Now accepts `language=` and passes `vectorizer_model=_build_label_vectorizer(language)` + `language=_bertopic_language_kwarg(language)` to `BERTopic(...)`. |
| `_build_online_pipeline(...)` | Same treatment; previously had partial language-routing for stopwords only. |
| `_load_corpora_from_workspace(...)` | Now returns `(raw_corpora, vectorizer_corpora, tokens_columns)`. The second list mirrors the first row-for-row, with the derived `__derived__.<form>.<src>.<model>` column space-joined when present, else `None` for that node. |
| `_compute_topics()` (in `run_topic_modeling_task`) | Builds two flat doc streams: `all_docs` (raw, fed to the embedder) and `all_docs_for_vectorizer` (pre-tokenised where available, raw text where not). The latter is passed to `fit_transform`, `reduce_topics`, and `_persist_exact_reduction_artifact` so exact-mode re-aggregation stays consistent. |

Plumbing into the request flow (`api/workspaces/analyses/topic_modeling.py`)
needed **no** changes — the route already resolves `language` via
`effective_language(request.language, first_node)` and forwards it to the
worker. The derived tokens column is discovered inside the worker by
`node.find_derived_column(text_column, form="tokens")` (first-match,
same convention as concordance and token-frequency).

## What stays stable

- **Embedding cache.** Keyed by `(model_id, revision, doc_text)`. We still
  encode the raw text column, so existing cached embeddings remain valid;
  no re-encode storm on first multilingual run after upgrade.
- **API contract.** `TopicModelingRequest` is unchanged. The added
  `meta.language_resolution` block is additive — older frontends that
  ignore it just don't show the new banner.
- **English flows.** When `effective_language` resolves to `"en"`,
  `_build_label_vectorizer("en")` returns `CountVectorizer(stop_words="english")`
  — identical to BERTopic's default. Output is byte-identical to pre-fix
  behaviour for English corpora.
- **Exact-mode reaggregation.** `_persist_exact_reduction_artifact` now
  stores `all_docs_for_vectorizer` instead of `all_docs`. The
  reaggregation path (`reaggregate_exact_topic_modeling_result`) reads it
  back and passes it to `reduce_topics` — by definition consistent with
  the original fit's doc stream.

## Tests added

In [backend/tests/unit/test_topic_modeling_stopwords.py](../../backend/tests/unit/test_topic_modeling_stopwords.py):

| Test | Asserts |
|---|---|
| `test_label_vectorizer_english_uses_sklearn_english_stoplist` | `_build_label_vectorizer("en").stop_words == "english"`. |
| `test_label_vectorizer_chinese_drops_stopwords_and_uses_unicode_word_regex` | `stop_words is None`, `token_pattern == r"(?u)\b\w+\b"`. |
| `test_label_vectorizer_segments_space_joined_chinese_tokens` | Documents the contract that the regex on `"中文 分词 测试"` extracts `["中文", "分词", "测试"]`. |
| `test_classic_pipeline_attaches_multilingual_vectorizer_for_chinese` | Confirms the *classic* (not just online) pipeline is fixed. |
| `test_classic_pipeline_keeps_english_default_for_english` | Backward-compatibility guard for English. |
| `test_bertopic_language_kwarg_maps_to_multilingual_for_non_en` | en/None → `"english"`; zh/ja/multi → `"multilingual"`. |

`test_topic_modeling_worker.py` was updated so its FakeBERTopic stubs
accept the new `vectorizer_model` and `language` kwargs without
asserting on them (the dedicated tests above are the source of truth
for those kwargs).

## Follow-up fix: `top_n_words` was silently capped at 10

User-reported symptom: on a tokenised ZH run with "Words per topic" set
to 35 and the stopword filter on, most topics displayed only 1–3 words.
Setting "Words per topic" back to 15 gave the same 1–3 words. The
display cap and the filter both looked broken.

The real bug: **BERTopic's `top_n_words` parameter defaults to 10 and we
never overrode it.** Our payload builder happily sliced
`words[:max_representative_words]`, but the source list was at most 10
elements regardless of the user's input. For ZH where ~70% of c-TF-IDF
top words are function words (的/是/了/在/我/...), the stopword filter
then removed 5–9 of those 10, leaving the 1–3 the user observed.

Fix in [worker_tasks_topic.py](../../backend/src/ldaca_web_app/core/worker_tasks_topic.py):

- New helper `_resolve_top_n_words(representative_words_count)` returns
  `max(50, requested * 2)` — at least 50, otherwise 2× the user's cap.
  Headroom for the stopword filter and effectively zero performance
  cost (c-TF-IDF already ranks the whole vocabulary; `top_n_words`
  only decides where to truncate).
- Threaded through `_build_classic_pipeline(..., top_n_words=...)` and
  `_build_online_pipeline(..., top_n_words=..., top_n_words=...)`, both
  of which now pass the value to `BERTopic(...)`.
- Called once per run in `_compute_topics` from the resolved
  `representative_words_count` so both pipelines see the same value.

Regression tests in [test_topic_modeling_stopwords.py](../../backend/tests/unit/test_topic_modeling_stopwords.py)
assert the helper's contract and that the kwarg **actually reaches the
BERTopic model** (not just that we pass it to our own helper) — that
was the failure mode here: code looked right at every layer until you
realised the underlying default was never overridden.

| Requested cap | `top_n_words` | Expected post-filter (rough, ZH) |
|---|---|---|
| 5 | 50 | 15–25 candidates → ample for 5 displayed |
| 15 | 50 | 15–25 candidates → matches 15 cap |
| 35 | 70 | 25–40 candidates → matches 35 cap |
| 100 | 200 | 60–100 candidates → matches 100 cap |

This is independent of CJK — English runs also benefit from the higher
ceiling (no behaviour change since sklearn's English stoplist already
filters at the vectorizer step, but headroom is consistent).

## Follow-up fix: struct-field leak in the vectorizer corpus

First user test surfaced two symptoms:

1. Every topic's top words started with the literal English words
   `token`, `start`, `end`.
2. CJK stopwords (的, 是, 了, ...) dominated the rest of every label.

### "token / start / end" leak — fixed in this branch

The derived tokens column is shaped as
`list<struct<token: str, start: i64, end: i64>>` — `start`/`end` are byte
offsets the concordance engine needs. When the worker built the
vectorizer corpus, it called `str(t)` on each struct element, which
produced `{'token': '中文', 'start': 0, 'end': 2}` and joined those reprs
with spaces. After hitting `(?u)\b\w+\b`, every document contributed
the English words `token`, `start`, `end` once per token, so c-TF-IDF
ranked them at the top of every cluster.

Fix in [worker_tasks_topic.py:_load_corpora_from_workspace](../../backend/src/ldaca_web_app/core/worker_tasks_topic.py): project the struct field before joining, mirroring the
projection token-frequency already uses:

```python
node.data.select(
    pl.col(tokens_column)
    .list.eval(pl.element().struct.field("token"))
    .alias("__tokens_col__")
).collect()
```

Same `list.eval(pl.element().struct.field("token"))` shape as
[`token_frequencies.py:465-468`](../../backend/src/ldaca_web_app/api/workspaces/analyses/token_frequencies.py#L465-L468). No new tests needed beyond the existing
ones — the bug was in a code path none of the unit fixtures exercised
(they all set `tokens_column` to `None`); the integration symptom is
gone with the projection in place.

### Frontend stopword filter — landed

Backend stays neutral (we still do not inject CJK stopwords into the
CountVectorizer — see "No backend stopwords" above). The filter is purely
post-fit and client-side, so it's:

- **Reproducible**: backend output is unchanged. Two users see the same
  raw topics regardless of how they configure the filter.
- **Reversible**: toggling off restores the original labels.
- **Future-extensible**: bundling new languages is just adding a `.txt`
  file next to `zh.txt`; no API surface to renegotiate.

#### Where the data lives

The frontend filter fetches from the **existing** backend stopword
endpoint at `/text/default-stop-words` rather than bundling files in
the frontend. Reuses the same path token-frequency already calls, so
the lists stay centrally maintained and any future analysis tool gets
them for free.

- [backend/src/ldaca_web_app/resources/stopwords_zh.txt](../../backend/src/ldaca_web_app/resources/stopwords_zh.txt) — 746-entry list from [goto456/stopwords](https://github.com/goto456/stopwords) (cn_stopwords.txt). Loaded alongside the existing `stopwords_{en,es,fr,de}.txt`.
- [backend/src/ldaca_web_app/api/text.py](../../backend/src/ldaca_web_app/api/text.py) — `LANGUAGE_FILE_MAP` extended with `zh`/`chinese`. The endpoint gained a `strict=true` query param so unknown languages return `[]` instead of silently substituting the English list. Topic-modelling passes `strict=true` so its toggle can be hidden cleanly when no list exists; token-frequency keeps the legacy fallback for its "fill defaults" UX.
- [frontend/src/features/analysis/common/hooks/useDefaultStopwords.ts](../../frontend/src/features/analysis/common/hooks/useDefaultStopwords.ts) — `useDefaultStopwords(language, { strict })` hook with TanStack Query caching (1-hour `staleTime` since these lists don't change at runtime). Returns `{ stopwords: Set<string>, available, isLoading, isError }`. Any analysis can consume it.

#### Where the filter applies

[TopicModelingFeature.tsx](../../frontend/src/features/analysis/topic-modeling/TopicModelingFeature.tsx)
extends its existing topics memo with stopword-aware filtering:

```ts
const resolvedTopicLanguage = (() => {
  // On multilingual, meta.language_resolution.language carries en/zh/ja/...
  // On dev (no language_resolution block), default to "en" — every run
  // is implicitly English. The hook itself hides the toggle when the
  // backend has no list for the resolved language.
  const raw = result?.data?.meta?.language_resolution?.language;
  return (typeof raw === 'string' ? raw : 'en').trim().toLowerCase();
})();

const { stopwords: stopwordSet, available: stopwordFilterAvailable } =
  useDefaultStopwords(resolvedTopicLanguage, { strict: true });

const topics = useMemo(() => {
  // For each topic:
  //   - drop matching words from representative_words when toggle is on
  //   - hide topics where all words got filtered out
  //   - recompute label from the surviving slice
}, [result, representativeWordsCount, stopwordFilterEnabled, stopwordFilterAvailable, stopwordSet]);
```

The toggle (a checkbox next to "Topics (N)" in the results panel) only
renders when the resolved language has a backend list (`available`
becomes true after the fetch resolves). Defaults **off** so the user
sees the unfiltered output first; turning it on hides function words
and any topic whose representative words collapse to empty.

This split — backend serves the lists, frontend filters post-fit — is
why the feature works identically on the `dev` branch with the English
list and on `multilingual` with the Chinese list, with no per-branch
divergence in the filter UI itself.

#### What's deliberately not done yet

- **Per-language stopword lists beyond ZH.** Easy to add (drop a `ja.txt`
  / `ko.txt` next to `zh.txt` and register it in `RAW_SOURCES`), but no
  validated source picked yet.
- **Customisable stopwords (add/remove from UI).** The current implementation
  uses the bundled list as-is. If a user wants to drop `因为` from the
  list, they have to do it in source. We'll consider an editable
  per-user override after we see how the bundled list performs.
- **Backend pre-fit stopword removal option.** Per the agreed plan:
  evaluate the frontend filter first, then decide whether to expose a
  "remove stopwords before BERTopic" switch on the run parameters.
  Backend support would require either feeding the c-TF-IDF vectorizer
  a `stop_words=[...]` list (low-effort) or actually dropping the
  tokens from the doc stream before `fit_transform` (changes the
  cluster shape). Decision deferred until user feedback lands.

## Future work (not in this fix)

1. **Pre-run popup.** Frontend reads `node.derived` for the selected
   column and shows the Cancel / Tokenise-then-proceed / Proceed-with-raw-text
   dialog when the column is non-English and untokenised.
2. **Post-run "labels may be degraded" banner.** Reads
   `meta.language_resolution.label_vectorizer_mode === "raw_text_fallback"`
   and shows an inline notice on the results panel.
3. **Model picker for the tokens column.** Symmetric to the concordance
   and token-frequency pickers we added in Phase 4, for nodes that have
   been tokenised under more than one model.
4. **Backend pre-fit stopword removal** — see "What's deliberately not
   done yet" above.

---

## Update 2026-05-14 — JA tokenisation now actually works

When this fix originally shipped, Japanese had the right multilingual
vectorizer plumbing (this doc) **but** the recommended JA tokenizer
itself never worked end-to-end. `cl-tohoku/bert-base-japanese-v3` has
no `tokenizer.json` published on HuggingFace Hub — it relies on
Python-side `BertJapaneseTokenizer` + MeCab, which the polars-text
Rust HF backend cannot load. Any attempt to run a Tokenise on a JA
corpus returned ``Tokenizer init failed: Failed to fetch tokenizer.json
for cl-tohoku/bert-base-japanese-v3`` so the label-stage fix here only
helped users whose JA corpus had been tokenised externally (rare).

This is fixed by Phase 5 (Lindera) — see [PLAN.md §Phase 5](./PLAN.md#phase-5--lindera-japanese--korean-morphology-backend-2-working-sessions--code-complete).
After Phase 5 lands:

- `RECOMMENDED_TOKENIZERS["ja"]` is now `"lindera-ja-ipadic"` (with
  `"lindera-ja-unidic"` available as an opt-in alternate).
- `RECOMMENDED_TOKENIZERS["ko"]` is now `"lindera-ko-dic"` (replaces
  the working-but-sub-word `klue/bert-base`).
- The dict is downloaded on first use into the per-OS cache dir.
- The frontend `TokeniseDialog` exposes the IPADIC vs UniDic choice
  via a "Dictionary" selector; KO has only ko-dic so the selector
  hides.

The rest of this doc (label-stage multilingual vectorizer, no-English-stopwords-for-CJK,
raw-text fallback, etc.) is unchanged. Phase 5 just makes the JA
input side of the pipeline work; the rest still kicks in as
described above.
