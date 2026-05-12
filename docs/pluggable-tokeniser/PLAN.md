# Pluggable Tokeniser & Multilingual Support — Implementation Plan

**Branch:** `pluggable_tokeniser` (root + `backend/`, `polars-text/`, `docworkspace/`)
**Status:** Planning — no code changes yet
**Started:** 2026-05-09
**Last synced from `dev`:** 2026-05-12 (merge `3a94214`); references audited and confirmed current
**Owner:** chao.sun@sydney.edu.au

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

5. **Tokenizer paradigm pluggability is achievable in pure Rust.** `jieba-rs` and `lindera` are mature Rust crates. The polars-text architecture is not bound to HuggingFace's `tokenizers` crate; a small `TokenizerBackend` enum behind a trait keeps everything in one Polars expression.

## Scope summary

| Module        | Role                                                                                         | Branch needed |
|---------------|----------------------------------------------------------------------------------------------|---------------|
| `polars-text` | Tokenizer registry, Polars expression API, persisted tokens schema, optional Jieba/Lindera  | Yes           |
| `backend`     | Node metadata, tokenize worker task, API endpoints, per-tool language routing                | Yes           |
| `docworkspace`| Node language/tokenizer metadata, schema versioning, `Node.shape` fix for list columns       | Yes           |
| Root repo     | Submodule pin bumps, end-to-end test fixtures, frontend UI, packaging verification           | Yes (this)    |
| `ldaca-tabulator` | (Likely no changes)                                                                       | Probably no   |

---

## Phase 0 — Baseline & test fixtures (~1–2 days)

**Goal:** establish a regression net so every later change is provable.

| #   | Task | Acceptance |
|-----|------|------------|
| 0.1 | Add tiny multilingual fixtures: 100-doc EN, ZH, JA samples under `tests/fixtures/multilingual/` | Files present, loadable |
| 0.2 | Snapshot current English outputs (token freq top-50, concordance KWIC for one keyword, topic count for k=5) into golden files | Golden files committed |
| 0.3 | Inventory existing tests in `polars-text/tests/`, `docworkspace/tests/`, `backend/tests/`, `tests/`; record green baseline on `pluggable_tokeniser` | All currently-passing tests still pass |

**Exit:** `cargo test`, `pytest` in all three Python packages, and the existing golden English flows all green on the branch.

---

## Phase 1 — Pluggable HF tokenizer in Rust (~1.5–2 weeks)

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

**Tests per task:**
- 1.1–1.3 (Rust unit): same input + two different `model_id`s → different token streams. Same `model_id` twice → cache hit.
- 1.6 (Python integration): tokenize same English string with `bert-base-uncased` vs `bert-base-multilingual-cased`; outputs differ. Tokenize Chinese with `bert-base-chinese`; non-empty char-level tokens.
- 1.7 (Python unit): prefetch a model, then call `list_loaded_models()`, assert presence.
- **Regression:** Phase 0 golden files unchanged when `model_id` is omitted.

**Exit:** Python user can switch tokenizer per call, English defaults unchanged, Chinese tokenization works at the polars-text layer (not yet exposed to backend).

---

## Phase 2 — Persisted tokens column + Tokenize node op (~1.5 weeks)

**Goal:** make a tokenised representation a first-class, persistent thing. Token-consuming tools auto-detect and use it. **This is the load-bearing phase** — it's what makes Jieba/MeCab integration trivial later, and what makes concordance/frequency consistent.

| #   | Task | File(s) | Acceptance |
|-----|------|---------|------------|
| 2.1 | Define canonical token schema constant `TOKENS_tokens: List[Struct{token, start, end}]` | `backend/src/ldaca_web_app/api/workspaces/analyses/generated_columns.py` | Constant + projection helper |
| 2.2 | Add Polars expression mode that emits the offset-struct schema | `polars-text/src/expressions.rs:105-135` | New `tokenize_with_offsets` or kwarg flag |
| 2.3 | Add `worker_tasks_tokenize.py` worker | new in `backend/src/ldaca_web_app/core/` | Produces child node with tokens column persisted to `.plbin` |
| 2.4 | Add `language` + `tokenizer_model` fields to Node metadata (NOT the dataframe) | `docworkspace/src/docworkspace/node/core.py:48-51`, `node/io.py:44-53` | Round-trips through plbin save/load |
| 2.5 | Add API endpoint `POST /workspaces/{id}/nodes/{node_id}/tokenize` | new in `backend/src/ldaca_web_app/api/workspaces/analyses/` | Creates child node with lineage |
| 2.6 | Modify concordance to detect tokens column and consume it | `polars-text/src/concordance.rs`, `backend/src/ldaca_web_app/core/worker_tasks_concordance.py:93` | KWIC `l1`/`r1` match upstream tokens exactly |
| 2.7 | Modify token frequency to consume tokens column when present | `backend/src/ldaca_web_app/core/worker_tasks_token.py:99` | Counts agree with persisted tokens |
| 2.8 | Fix `Node.shape` to avoid materialising list columns | `docworkspace/src/docworkspace/node/core.py:88-90` | Tokenised node `shape` query is fast and memory-stable |
| 2.9 | Source-path rebasing handles the new schema (`rebase_workspace_sources()`) | `docworkspace/src/docworkspace/workspace/io.py:168-184` | Move + reload workspace works |

**Tests per task:**
- 2.1–2.2 (Rust + Python unit): tokenize a known string, assert offsets reconstruct original substrings.
- 2.3, 2.5 (backend integration): create a doc node, POST tokenize, assert child node exists with right schema and lineage.
- 2.4 (docworkspace unit): set language/tokenizer_model, save, load, assert preserved.
- 2.6, 2.7 (cross-package integration): tokenize a node with model X, run concordance and frequency on the *parent*; assert results equal running them directly with model X. Then run on the *child* tokens node; assert identical results. **This is the consistency proof.**
- 2.8 (docworkspace unit + benchmark): assert `node.shape` on a 100k-row tokenised node uses bounded memory and returns in <100ms.
- 2.9 (workspace integration): copy workspace dir to a new path, reload, assert lazy plans still resolve.

**Exit:** Tokenise a Chinese corpus with `bert-base-chinese` from the backend, run frequency + concordance against it, results agree token-for-token. Phase 0 English goldens still match (default path unchanged).

---

## Phase 3 — Per-tool language routing (~1.5–2 weeks)

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

## Phase 4 — Frontend UI (~3–5 days)

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

**Tests:**
- Browser dev-server walkthrough: import a small ZH CSV → tokenise → run frequency → see ZH tokens. Try quotation → see disabled tooltip. Save and reload workspace → state preserved.
- Type-check + ESLint pass.

**Exit:** an end-to-end Chinese run is achievable without any backend curl.

---

## Phase 5 (optional) — Jieba + Lindera backends (~1 week)

**Goal:** word-level CJK segmentation as an alternative to char-level mBERT.

| #   | Task | Acceptance |
|-----|------|------------|
| 5.1 | Define `TokenizerBackend` enum/trait in Rust; refactor existing HF path into one variant | All Phase 1–3 tests still green |
| 5.2 | Add `jieba-rs` variant; bundled default dict | ZH text segments into words, not chars |
| 5.3 | Add `lindera` variant; on-demand IPADIC download (mirror HF Hub flow at `tokenizer.rs:17-28`) | JA text segments into morphemes |
| 5.4 | Surface in frontend selector (zh-jieba, ja-lindera as alternates) | User can pick |
| 5.5 | Measure install size before/after; document trade-off | Stays within size constraint |

**Tests:** parametrised fixtures comparing same-input outputs across backends; install-size diff measured in CI.

**Decision gate before starting Phase 5:** ship Phase 1–4 to a few CJK users; ask whether char-level mBERT is good enough. If yes, Phase 5 is deferrable indefinitely.

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
