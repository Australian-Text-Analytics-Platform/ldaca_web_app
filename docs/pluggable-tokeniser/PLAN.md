# Pluggable Tokeniser & Multilingual Support — Implementation Plan

**Branch:** `pluggable_tokeniser` (root + `backend/`, `polars-text/`, `docworkspace/`)
**Status:** In progress — Phase 2 complete (all v2 redesign tasks landed); Phase 3 next
**Started:** 2026-05-09
**Last synced from `dev`:** 2026-05-12 (merge `3a94214`); references audited and confirmed current
**Owner:** chao.sun@sydney.edu.au

## Progress snapshot (updated as work lands)

| Phase | Status | Notes |
|-------|--------|-------|
| 0 — Baseline & fixtures | ✅ done | 502 baseline tests green; EN goldens committed |
| 1 — Pluggable HF tokenizer in Rust | ✅ done | tokenizer + POS + embedder registries, model= kwarg, prefetch helpers, models.py |
| 1.9 — Jieba Chinese backend | ✅ done | TokenizerBackend enum (HF + Jieba); `zh = "jieba"` |
| 2 — Derived tokens column on source node | ✅ done (v2 design — decision 7) | all 7 tasks landed across docworkspace + backend; 431 backend + 91 docworkspace tests green; consistency proof (2.6 tokens-mode + 2.7 freq path) lives |
| 3 — Per-tool language routing | ⏳ pending | |
| 4 — Frontend UI | ⏳ pending | |
| 5 (opt) — Lindera (Japanese) backend | ⏳ deferred | decision gate after Phase 4 ships |

This is the cross-module plan. Per-module sub-plans (to be added if needed):

- `backend/docs/pluggable-tokeniser/PLAN.md` — Node metadata, tokenize worker task, API endpoints, per-tool language routing
- `polars-text/docs/pluggable-tokeniser/PLAN.md` — Rust tokenizer registry, Polars expression API extensions, optional Jieba/Lindera backends
- `docworkspace/docs/pluggable-tokeniser/PLAN.md` — Node language/tokenizer metadata, schema versioning, lazy collection fixes

The top-level work — coordinated submodule pin bumps, end-to-end multilingual test fixtures, frontend UI, release coordination — lives here.

---

## Goal

Enable the web app to handle multilingual corpora (initially Chinese, Japanese, plus other languages mBERT/XLM-R support) and produce **internally consistent results** across analytical tools by making tokenisation a configurable, first-class step.

Today's behaviour:
- Hardcoded `bert-base-uncased`, `OnceCell` singleton, no model selection
- Three independent tokenisers in active use (polars-text BERT, spaCy, sentence-transformers) — token counts disagree across tools even on English
- POS, quotation, and embedder are all English-only
- Tokens are never persisted; every tool re-tokenises raw text
- Frontend has no language/tokenizer UI

Target after this work:
- User can pick a language at corpus import; correct tokeniser models auto-loaded
- A persistent tokens column is the contract between token-consuming tools (concordance, frequency, POS) — they all agree
- Topic modeling embedder is multilingual
- Quotation extractor is explicitly English-only with a clear UI signal on non-English nodes
- Default English flow is unchanged (no regressions)

## Hard constraints

- **No regression to English flows.** All existing English workflows must produce byte-identical results when the new parameters take their defaults.
- **Lazy-first architecture preserved.** Adding a tokens column must not force eager `.collect()` on every node info query. `Node.shape` and similar must work on tokenised nodes without materialising list columns.
- **Install-size budget.** See [memory: project_deployment_targets.md](../../../.claude/projects/-Users-mily-Workspace-ATAP-LDaCA-Text-Analytics-Tools-ldaca-web-app/memory/project_deployment_targets.md). New tokenizer model dictionaries (lindera IPADIC ~50–200 MB) must be on-demand-downloaded, not bundled.
- **Backward-compatible Node persistence.** Old workspaces (without language metadata) must load and behave as English by default.

## Architectural decisions

These decisions came out of the planning discussion; documenting here so the rationale survives long after the conversation.

1. **No DTM-everywhere refactor.** The atap-corpus pre-tokenised DTM model is appealing for uniformity but a poor fit here: it forces eager materialisation (regressing the lazy-polars advantage), and a single DTM doesn't actually unify the tools that need different representations (topic modeling needs embeddings, quotation needs dependency parses, AI annotation needs raw text). The right unit is "language-aware analysis", not "uniform tokens for every tool".

2. **Layer 2 (persisted tokens column) is load-bearing, not optional.** Concordance currently re-tokenises its context internally with regex. The moment we introduce non-regex tokenisers (Jieba, MeCab, or even Chinese WordPiece via `bert-base-chinese`), this internal re-tokenisation will diverge from the user's frequency counts. The persisted tokens column with offsets `List[Struct{token, start, end}]` is the contract that keeps tools agreed.

3. **Default mBERT/XLM-R is a fallback, not the primary multilingual story.** For each headline language we want quality per-language models (`bert-base-chinese`, `cl-tohoku/bert-base-japanese-v3`), with `xlm-roberta-base` as the "unknown language" fallback and `bert-base-multilingual-cased` available for users who explicitly want it.

4. **Quotation extraction is explicitly English-only.** The upstream rule set is English/French only and won't generalise. Plan calls for a typed `UnsupportedLanguageError` and a UI tooltip, not silent English fallback.

5. **Tokenizer paradigm pluggability is achievable in pure Rust.** `jieba-rs` and `lindera` are mature Rust crates. The polars-text architecture is not bound to HuggingFace's `tokenizers` crate; a small `TokenizerBackend` enum keeps everything in one Polars expression. **Jieba landed in Phase 1.9** (pulled forward from Phase 5) because character-level Chinese is not linguistically meaningful in practice — the plan owner is a Chinese speaker and confirmed this directly. Lindera (Japanese) stays in Phase 5, deferred until a Japanese speaker can verify; the same `TokenizerBackend` enum gains a third variant when that lands.

6. **Concordance keeps TWO modes, not one.** The current regex-on-raw-text mode is preserved as the default because partial-word patterns like `equ\w*` are a real linguistic affordance for English users that any DTM-only design would destroy. A second tokens-column-driven mode is added in Phase 2.6 for CJK and any case where exact-token-match + N-actual-token context (with language-appropriate segmentation) is the right semantics.
   - **Why this matters for CJK**: today, when concordance is run on Chinese text, `num_left_tokens=5` silently means "5 characters" because `BertPreTokenizer` falls back to per-character splitting in the absence of whitespace. The text-mode search still works (literal substring match), but the context window is much less semantically useful than the user expects. The tokens-column mode (after Phase 5 with Jieba/Lindera) gives "5 actual words left/right" which is what a corpus linguist actually wants.
   - **English `equ\w*` is not lost**: regex-mode stays the default; CJK users can opt into tokens-mode after running Tokenise on their node.

7. **Derived analytic columns (tokens, POS, NER, etc.) live on the source node as hidden columns, NOT as detached child nodes.** Two designs were considered and rejected:
   - **(A) A new child Node per tokenisation** — explodes the workspace tree: a user with 5 string columns and 2 tokeniser models would end up with 10 nodes none of which they ever want to view. Tokens aren't new data; they're a representation of an existing column.
   - **(C) A row-aligned shadow LazyFrame attached to each Node** — conceptually clean (user-facing schema stays pure) but Polars has no native "row-aligned attached frame" abstraction, so the row-alignment invariant would have to be maintained by hand across `filter` / `slice` / `sort` / `dedupe` / `join` / `groupby`, plus persistence becomes two files per node. Substantial ongoing tax for marginal gain.
   - **Chosen design (B): derived columns on the same Node.** Each derived column lives on the source node's LazyFrame, named `__derived__.<form>.<source_column>.<model>` (e.g. `__derived__.tokens.text.jieba`). Per-column metadata (`source_column`, `form`, `model`, `language`, `generated_at`) lives in `Node.derived: dict[str, DerivedColumnMeta]`. Lazy by default — the derived column is added to the polars plan via `with_columns`, materialised only when a downstream tool reads it. Optional eager `materialise=True` for hot paths.
   - **Why the user's schema stays clean**: backend strips `__derived__.*` from any frontend-facing schema projection (`node.info()`, data-view payloads, export schemas). The user never sees them in the data view, CSV/Parquet export, or the polars-expression editor. Analytics tools see the full schema and look up the right derived column via `find_tokens_column(node, source_column)`.
   - **Row-alignment is automatic** because polars maintains it: every row-changing op (`filter`, `slice`, `sort`, `dedupe`) applies to all columns including derived. The one explicit rule: when a source column is mutated or dropped, derived columns referencing it become stale — auto-dropped with a UI notice.
   - **Multiple tokenisers per column** work out of the box: `__derived__.tokens.text.jieba` and `__derived__.tokens.text.bert-base-chinese` are different columns on the same node; the user can compare without creating new nodes.

## Scope summary

| Module        | Role                                                                                         | Branch needed |
|---------------|----------------------------------------------------------------------------------------------|---------------|
| `polars-text` | Tokenizer registry, Polars expression API, persisted tokens schema, optional Jieba/Lindera  | Yes           |
| `backend`     | Node metadata, tokenize worker task, API endpoints, per-tool language routing                | Yes           |
| `docworkspace`| Node language/tokenizer metadata, schema versioning, `Node.shape` fix for list columns       | Yes           |
| Root repo     | Submodule pin bumps, end-to-end test fixtures, frontend UI, packaging verification           | Yes (this)    |
| `ldaca-tabulator` | (Likely no changes)                                                                       | Probably no   |

---

## Phase 0 — Baseline & test fixtures (~1–2 days) ✅ COMPLETE

**Goal:** establish a regression net so every later change is provable.

| #   | Task | Acceptance |
|-----|------|------------|
| 0.1 | Add tiny multilingual fixtures: 100-doc EN, ZH, JA samples under `tests/fixtures/multilingual/` | Files present, loadable |
| 0.2 | Snapshot current English outputs (token freq top-50, concordance KWIC for one keyword, topic count for k=5) into golden files | Golden files committed |
| 0.3 | Inventory existing tests in `polars-text/tests/`, `docworkspace/tests/`, `backend/tests/`, `tests/`; record green baseline on `pluggable_tokeniser` | All currently-passing tests still pass |

**Exit:** `cargo test`, `pytest` in all three Python packages, and the existing golden English flows all green on the branch.

---

## Phase 1 — Pluggable HF tokenizer in Rust (~1.5–2 weeks) ✅ COMPLETE (including 1.9)

**Goal:** parameterise model selection through the Polars expression API. No new tokenizer backends yet (still HF only). No persisted tokens column yet.

| #   | Task | File(s) | Acceptance |
|-----|------|---------|------------|
| 1.1 | Replace `OnceCell<Tokenizer>` with `RwLock<HashMap<String, Arc<Tokenizer>>>` registry | `polars-text/src/tokenizer.rs:11` | Two model IDs can coexist in one process |
| 1.2 | Extend `TokenizeKwargs` with `model_id: Option<String>` (default = current) | `polars-text/src/expressions.rs:175-179` | Default omitted = identical behavior |
| 1.3 | Thread `model_id` through `tokenize_text` and `tokenize_plain_text` | `polars-text/src/tokenizer.rs:34-96` | Compiles; uses registry |
| 1.4 | Same singleton→registry treatment for POS | `polars-text/src/pos_tagging.rs:14-33` | Compiles |
| 1.5 | Same for embedder | `polars-text/src/topic_modeling.rs:22-31` | Compiles |
| 1.6 | Update Python namespace: `.text.tokenize(model="bert-base-uncased", ...)` | `polars-text/polars_text/namespace.py:13-16`, `functions.py:10-22` | Type-checked, default = current |
| 1.7 | Add `polars_text.prefetch_model(model_id)` and `list_loaded_models()` helpers | new in `polars-text/polars_text/` | Round-trip works |
| 1.8 | Pin a small "known good" model registry in Python (en/zh/ja/multi/fallback) | new `polars_text/models.py` | Lookups return valid HF IDs |
| 1.9 | **Jieba Chinese backend (pulled forward from Phase 5).** Introduce `TokenizerBackend` enum (`HuggingFace` \| `Jieba`) in `tokenizer.rs`; refactor the registry to cache `Arc<TokenizerBackend>`; route `model_id == "jieba"` to `jieba-rs`. Update `RECOMMENDED_TOKENIZERS["zh"]` from `bert-base-chinese` to `"jieba"` so the two-mode concordance design (decision 6) delivers *word-level* Chinese context as soon as Phase 2 lands. Lindera (Japanese) remains in Phase 5. | `polars-text/Cargo.toml`, `polars-text/src/tokenizer.rs`, `polars-text/polars_text/models.py`, new `polars-text/tests/test_jieba_chinese.py` | `.text.tokenize("今天天气很好", model="jieba")` produces word-level tokens like `["今天", "天气", "很好"]` (not chars). EN goldens unchanged. Jieba's ~5 MB bundled dict ships in-binary; no on-demand download needed. |

**Tests per task:**
- 1.1–1.3 (Rust unit): same input + two different `model_id`s → different token streams. Same `model_id` twice → cache hit.
- 1.6 (Python integration): tokenize same English string with `bert-base-uncased` vs `bert-base-multilingual-cased`; outputs differ. Tokenize Chinese with `bert-base-chinese`; non-empty char-level tokens.
- 1.7 (Python unit): prefetch a model, then call `list_loaded_models()`, assert presence.
- 1.9 (Python integration): tokenize Chinese with `model="jieba"`; assert tokens are word-level (multi-character tokens present, not pure char-level). Compare against `bert-base-chinese` to show different segmentation.
- **Regression:** Phase 0 golden files unchanged when `model_id` is omitted.

**Exit:** Python user can switch tokenizer per call, English defaults unchanged, Chinese tokenization works at the polars-text layer — char-level via `bert-base-chinese` AND word-level via `"jieba"` (not yet exposed to backend; that's Phase 2/3).

---

## Phase 2 — Derived tokens column on the source node (~1.5 weeks) ✅ COMPLETE (v2 design — decision 7)

**Goal:** make a tokenised representation of any string column on a Node a first-class, persistent thing — **as a hidden derived column on the same Node**, not as a detached child node (see decision 7). Token-consuming tools (concordance tokens-mode, token-frequency tokens-path, future POS) auto-detect and use it. **This is the load-bearing phase** — it's what makes Jieba/MeCab consistency real, and what makes concordance/frequency agree across tools.

> **Redesign note (decision 7).** Earlier drafts of Phase 2 created a child Node per tokenisation. That was rejected: tokens aren't new data, they're a representation of an existing column; a user tokenising N columns × M models would otherwise produce N×M intermediate nodes none of which they'd open. The new design keeps derivatives on the source node as columns named `__derived__.<form>.<source_column>.<model>` (e.g. `__derived__.tokens.text.jieba`), with per-column metadata in `Node.derived`. Frontend strips the prefix from user-facing schema projections.
>
> **Already-landed work that needs revision under decision 7:**
> - **2.1 v1** (`TOKENS_tokens` fixed-string constant in `generated_columns.py`, committed `7b5d5eb`) → revise to `derived_column_name(form, source, model)` naming helper + parser. The `tokens_struct_dtype()` and detector helpers stay (renamed for clarity).
> - **2.4 v1** (`Node.language` / `Node.tokenizer_model` fields, committed `533cb5a`) → replace with `Node.derived: dict[str, DerivedColumnMeta]` keyed by derived-column name. The single-language fields were too coarse; multi-column corpora need per-column tracking.

| #   | Task | File(s) | Acceptance |
|-----|------|---------|------------|
| 2.1 v2 ✅ | Replace fixed `TOKENS_*` constants with `derived_column_name(form, source, model) -> str` and `parse_derived_column(name) -> (form, source, model) \| None`. Keep `tokens_struct_dtype()` (unchanged); add `is_derived_tokens_column(node, col_name)` reading from `Node.derived`; add `is_derived_column_name(name)` prefix check for the Phase 2.10 filter. | `backend/.../generated_columns.py` | landed (commit `a8b5e59`); 10 schema tests green |
| 2.2 ✅ | Polars expression `tokenize_with_offsets` (DONE — design unchanged) | `polars-text/src/expressions.rs` | landed (commit `5e5d025`), 44 polars-text tests green |
| 2.3 ✅ | Synchronous `tokenise_column(node, source_column, model, language) -> str` operation. Mutates the node's LazyFrame plan via `with_columns(pt.tokenize_with_offsets(pl.col(source_column), model=model).alias(derived_column_name(...)))` and updates `Node.derived`. Idempotent: re-call with same (source, model) replaces; different model adds another column. No child node created. | `backend/.../core/derived_columns.py` (new) | landed (commit `1966b5e`); 7 tests including jieba word-level ZH check |
| 2.4 v2 ✅ | Replace `Node.language` / `Node.tokenizer_model` with `Node.derived: dict[str, DerivedColumnMeta]` recording source_column, form, model, language, generated_at. Auto-drop derived columns when source is dropped or renamed. | `docworkspace/.../node/core.py`, `node/io.py` | landed (commit `ac50497`); 91 docworkspace tests green; drop/rename cascade verified |
| 2.5 ✅ | API: `POST /workspaces/nodes/{node_id}/derived/tokens` body `{ source_column, model, language }`. Returns `{ column, is_new, replaced_column? }`. Symmetric `DELETE /derived/{column_name:path}` (`:path` so model IDs with slashes work). Both update `Node.derived` and persist. | `backend/.../api/workspaces/analyses/derived_columns.py` (new) | landed (commit `fb7aee9`); 6 endpoint tests green |
| 2.6 ✅ | Concordance two-mode. Regex-mode (default) unchanged so Phase 0 goldens stay byte-identical. Tokens-mode (`search_mode="tokens"`) calls `Node.find_derived_column(column, form="tokens")`; if a hit, walks the list-of-struct column for exact-token matches with N-actual-token context. Materialised parquet flow keeps regex semantics for this phase. | `backend/.../api/workspaces/analyses/concordance_tokens_mode.py` (new), `concordance_core.py` (routing) | landed (commit `dd0cdbf`); 7 tokens-mode tests green |
| 2.7 ✅ | Token frequency: if `Node.find_derived_column(source_column, form="tokens")` returns a hit, extract the per-doc token lists at the API layer and pass them to the worker via a new `node_tokens` kwarg, which counts with `Counter`. Otherwise re-tokenise raw text as today. | `backend/.../api/workspaces/analyses/token_frequencies.py`, `core/worker_tasks_token.py` | landed (commit `c5f868b`); 4 derived-path tests including the consistency proof (tokens-path matches `col.list.explode().value_counts()`) |
| 2.8 ✅ | `Node.shape` lazy on List[Struct] columns | `docworkspace/.../node/core.py` | landed (commit `533cb5a`), regression test in place |
| 2.9 ✅ | Workspace rebase schema-agnostic | `docworkspace/.../workspace/io.py` | landed (commit `ee14f16`) |
| 2.10 ✅ | Frontend-facing schema projections strip `__derived__.*` from `node.info()`, data-view payloads. Analytics tools that consume tokens see the full schema (they read `node.data` directly). `node.derived` keys surface separately so a future panel can list them. | `backend/.../api/workspaces/schema_filter.py` (new), `nodes.py`, `base.py` | landed (commit `63d1e84`); 5 filter tests; 10 call sites updated |

**Tests per task:**
- 2.1 v2 (backend unit): naming round-trips; dtype contract holds against live polars-text.
- 2.3 (backend integration): tokenise the EN literary fixture's `text` column with default model; assert a single new `__derived__.tokens.text.bert-base-uncased` column; re-tokenise with same args → same column; tokenise with `model="jieba"` → second derived column added.
- 2.4 v2 (docworkspace unit): `Node.derived` round-trip through plbin; cascade auto-drop on source column drop; legacy nodes load with empty derived.
- 2.5 (backend integration): POST endpoint adds/replaces; DELETE removes; both 200 OK with expected payload.
- 2.6, 2.7 (cross-package integration): tokenise a node, run concordance / freq with tokens-mode, results match manual computation on the derived column. **This is the consistency proof.**
- 2.10 (backend integration): `node.info()` response excludes any column with `__derived__` prefix; `node.derived` dict is exposed as a separate field.

**Exit:** Tokenise `text` and `title` on a ZH corpus with Jieba in two API calls, both produce derived columns on the **same** node, frequency + concordance in tokens-mode read the right one given a `source_column` argument. Phase 0 EN goldens still match (regex/default paths untouched).

---

## Phase 3 — Per-tool language routing (~1.5–2 weeks) ⏳ PENDING

**Goal:** every remaining English assumption is either parameterised by language or explicitly declared English-only.

| #   | Task | File(s) | Acceptance |
|-----|------|---------|------------|
| 3.1 | Make embedder model selectable; default English, alt = `paraphrase-multilingual-MiniLM-L12-v2` | `polars-text/src/topic_modeling.rs:22-23`, `backend/src/ldaca_web_app/core/onnx_embedder.py:31`, `worker_tasks_topic.py:24` | Topic modeling on ZH corpus produces non-degenerate clusters |
| 3.2 | POS tagger language→model registry; en/zh/ja entries | `polars-text/src/pos_tagging.rs:14-16` | POS on ZH/JA returns plausible tags |
| 3.3 | Replace `'.!?'` sentence splitter with Unicode-aware (`。！？` etc.) | `polars-text/src/expressions.rs:95` | Splits ZH/JA sentences correctly |
| 3.4 | Replace `split_whitespace` word-count with tokens-column-aware count | `polars-text/src/expressions.rs:66` | Word count on ZH non-zero |
| 3.5 | Hardwire CountVectorizer `stop_words` choice off `language` (not `"english"`) | `backend/src/ldaca_web_app/core/worker_tasks_topic.py:164` | No English stopword leakage on ZH |
| 3.6 | Quotation extractor: explicit `language=="en"` gate; raise typed `UnsupportedLanguageError` otherwise | `backend/src/ldaca_web_app/core/quotation_extractor.py:31` | Non-EN node returns clear error, not garbage |
| 3.7 | AI annotation: pass language hint into prompt | `backend/src/ldaca_web_app/api/workspaces/analyses/ai_annotation_core.py:86` | Prompt includes language label |

**Tests per task:**
- 3.1: snapshot test on a small ZH fixture — top topic terms are Chinese, not pinyin/garbage.
- 3.2: small ZH/JA sentence in, assert token count and tag set are plausible (e.g., contains a NOUN tag).
- 3.3, 3.4: Rust unit tests on Unicode boundary cases.
- 3.5: assert `stop_words` argument is None or a ZH list when language="zh".
- 3.6: integration test — quotation on a ZH node returns the typed error; on an EN node still works.

**Exit:** every analysis tool has a defined behaviour on Chinese and Japanese corpora (works correctly, or explicitly declines). No silent English fallback anywhere.

---

## Phase 4 — Frontend UI (~3–5 days) ⏳ PENDING

**Goal:** expose the choice. Default is invisible to existing users.

> **Note (2026-05-12):** Frontend continues to evolve on `dev`. File paths below are current as of the last sync, but line numbers and component locations may drift further before Phase 4 starts. Verify each reference at implementation time. The directories most relevant to this phase — `frontend/src/api/text/`, `frontend/src/stores/`, `frontend/src/features/workspace/`, `frontend/src/components/panels/` — are stable; the per-feature file split inside them is what tends to move.

| #   | Task | File(s) | Acceptance |
|-----|------|---------|------------|
| 4.1 | Extend `preferencesStore` with `defaultLanguage`, `defaultTokenizerModel` (store now uses typed-slice pattern: `PreferencesState` + `PreferencesActions` with debounced subscribe-sync — add the new fields to `PreferencesState` and a setter to `PreferencesActions`) | `frontend/src/stores/preferencesStore.ts` | Persisted across reloads; round-trips through `UserPreferences` API |
| 4.2 | Language selector in `AddFilePanel` (insert above the sheet selector / preview block) | `frontend/src/components/panels/AddFilePanel.tsx` (sheet-selector block ~line 74 onward at last check) | New corpus carries language tag |
| 4.3 | Right-click "Tokenise" action on doc nodes | workspace tree component under `frontend/src/features/workspace/` (graph-view or data-view depending on context-menu location at the time) | Spawns Phase 2 task; shows progress |
| 4.4 | Add `tokenizer`/`language` to request types in the per-feature API modules | `frontend/src/api/text/` — `tokenFrequency.ts`, `concordance.ts`, `topicModeling.ts`, `aiAnnotation.ts`, `sequential.ts`; shared types in `shared.ts` and re-exports in `index.ts` | Backend receives the values |
| 4.5 | Disabled-reason tooltip "English-only" on quotation for non-EN nodes | quotation feature panel under `frontend/src/features/workspace/` (locate via `quotation_core` request usage) | Matches existing tooltip pattern from `da55cb8` |
| 4.6 | Node inspector shows language + tokenizer model | node info panel (whichever panel renders `nodeInfo` from `frontend/src/lib/nodeInfo.ts`) | Visible on selection |
| 4.7 | Concordance panel: "Search mode" toggle (regex vs. tokens); auto-pick tokens-mode when the active node has a tokens column; tooltip on `num_left/right_tokens` reads "characters in regex-mode on CJK; tokens in tokens-mode" | concordance feature under `frontend/src/features/workspace/` | Toggle visible; tokens-mode disabled when no tokens column present; CJK regex-mode shows the character-vs-token tooltip |

**Tests:**
- Browser dev-server walkthrough: import a small ZH CSV → tokenise → run frequency → see ZH tokens. Try quotation → see disabled tooltip. Save and reload workspace → state preserved.
- Type-check + ESLint pass.

**Exit:** an end-to-end Chinese run is achievable without any backend curl.

---

## Phase 5 (optional) — Lindera (Japanese morphology) backend (~3–5 days) ⏳ DEFERRED

**Goal:** word-level Japanese morpheme segmentation as an alternative to char-level / WordPiece tokenization. Jieba (Chinese) was pulled forward into Phase 1.9; Phase 5 now covers Lindera only.

| #   | Task | Acceptance |
|-----|------|------------|
| 5.1 | Add `lindera` variant to the existing `TokenizerBackend` enum (introduced in Phase 1.9) | All Phase 1–4 tests still green |
| 5.2 | On-demand IPADIC download (50–200 MB) mirroring the HF Hub flow at `tokenizer.rs:17-28`; cache in user data dir, not bundled | JA text segments into morphemes; install size unchanged before first JA use |
| 5.3 | Update `RECOMMENDED_TOKENIZERS["ja"]` from `cl-tohoku/bert-base-japanese-v3` to a Lindera identifier | JA tokens are linguistically meaningful morphemes |
| 5.4 | Surface in frontend selector as `ja-lindera` alternate | User can pick |
| 5.5 | Measure install size before/after; document trade-off | Stays within size constraint per `project_deployment_targets` |

**Tests:** parametrised JA fixtures comparing Lindera vs `cl-tohoku/bert-base-japanese-v3` outputs; install-size diff measured in CI.

**Decision gate before starting Phase 5:** ship Phase 1–4 (with Jieba for Chinese already live), validate the Chinese workflow with real users, then decide whether Japanese needs the same word-level treatment. The plan owner is a Chinese speaker and can verify Chinese end-to-end; Japanese verification requires a separate native-speaker test pass.

---

## Branching strategy

The work spans the root repo and three submodules; phase-by-phase isolation matters because the consistency proof (Phase 2) depends on the Rust pluggability landing first.

**Long-running feature branches (named `pluggable_tokeniser`):**
- root repo (this branch)
- `polars-text/` submodule
- `backend/` submodule
- `docworkspace/` submodule

The root `pluggable_tokeniser` branch always pins each submodule to a commit on that submodule's `pluggable_tokeniser` branch. Other ongoing work (releases, bug fixes) targets `dev`/`main` on the parent and `main` (or equivalent default) on each submodule, untouched.

**Phase branches:**
For each phase, create `pluggable_tokeniser/phase-N` off `pluggable_tokeniser` on whichever module(s) the phase touches. When the phase passes its exit criteria, fast-forward (or PR-merge) into the module's `pluggable_tokeniser` branch, then update the parent's submodule pin.

Phase-to-module map:
- Phase 0: root only (test fixtures)
- Phase 1: `polars-text` only
- Phase 2: `polars-text` + `backend` + `docworkspace` (use one phase branch per submodule, coordinate the pin bump as a single root commit)
- Phase 3: `polars-text` + `backend`
- Phase 4: root only (frontend lives here)
- Phase 5: `polars-text` + frontend (root)

**Periodic sync from `dev`:**
Merge `dev` into each `pluggable_tokeniser` branch at minimum at every phase boundary, ideally every 1–2 weeks. The longer the divergence, the more painful the eventual reconciliation — particularly in `polars-text/src/expressions.rs`, `backend/.../worker_tasks_*.py`, and the docworkspace Node code, all of which see active bug-fix traffic.

**Tagging at phase exits:**
After each phase passes its exit criteria, tag the root repo: `pluggable_tokeniser/phase-N`. Useful for rollback, and for sharing snapshots with CJK testers.

**Final merge to `dev`:**
Only after Phase 4 is fully tested end-to-end on EN, ZH, JA corpora, including a Tauri build to confirm packaging. Phase 5 can ship later as an independent follow-up.

**Why this is acceptable for parallel work:**
- Bug fixes on `dev` and feature work on other branches are not blocked at any point — `pluggable_tokeniser` does not touch `dev` until the very end.
- The submodule branches isolate the deep Rust/Python refactor from any release cuts that need to ship from `main`.
- Phase branches mean each ~1–2 week chunk has a defined scope, exit test, and rollback point.
- The main risk (long-running branch drift) is mitigated by phase-boundary merges from `dev`.

**Alternative considered and rejected:** stacked-PR / Graphite-style stack of dependent phase PRs. More elegant but the multi-submodule pinning makes the tooling fight the workflow.

---

## Cross-cutting risks

1. **Model download UX on first use.** A 700 MB multilingual model on a fresh install is a long blocking operation. Surface progress (Phase 4.3) and add an explicit prefetch step keyed off the existing `backend/src/ldaca_web_app/core/model_prefetch.py`.
2. **Install-size regression.** Hard constraint per [memory: project_deployment_targets.md](../../../.claude/projects/-Users-mily-Workspace-ATAP-LDaCA-Text-Analytics-Tools-ldaca-web-app/memory/project_deployment_targets.md). Track total wheel/dict size at the end of each phase; lindera dictionaries are the biggest threat (Phase 5).
3. **Tauri/UVX packaging.** Phase 1 changes the polars-text wheel signature; Phase 5 adds Rust deps. Run a Tauri build at the end of Phase 1 and Phase 5 to confirm nothing broke.
4. **Phase 2 is the linchpin.** If 2.6/2.7 (consistency proof) fails, do not proceed to Phase 3 — the rest of the plan rests on tools agreeing on the same token stream.
5. **Backward compatibility for existing workspaces.** Old `.plbin` workspaces have no language metadata; Phase 2.4 must default missing fields to English without forcing migration.

---

## Open questions to revisit before starting

- Do we want `xlm-roberta-base` as the multilingual default, or `bert-base-multilingual-cased`? XLM-R is generally better but has different vocabulary and slightly different speed profile.
- Should the tokens column be persisted as a child node (separate `.plbin`) or as an additional column on the parent node? The plan above assumes a child node; revisit if join cost becomes the bottleneck.
- Phase 5 sequencing: ship Phase 1–4 first and gather user feedback, or pull Phase 5 forward if the CJK testing reveals char-level segmentation is unusable for frequency analysis?
