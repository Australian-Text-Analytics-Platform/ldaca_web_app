# Changelog

User-facing changes to the LDaCA Text Analytics Web Application since v0.2.5.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] — 2026-05-15

The "multilingual" release. Opens the v0.4 line with end-to-end Japanese, Korean, and Chinese support across the analysis tools, plus a from-the-ground-up rework of how the workspace graph communicates node identity through colour. Also folds in the smaller 0.3.x improvements that shipped after 0.2.9 without their own CHANGELOG entries.

### Added

- **Multilingual concordance, token frequency, topic modelling, and AI annotation.** A new **Language** selector on the file-import panel tags each corpus at ingest time, and that tag flows through every downstream analysis tool. Concordance, token frequency, and topic modelling now use language-appropriate tokenisation and stopwords; AI annotation passes the corpus language as a prompt hint. Languages currently supported: English, Japanese, Korean, Simplified/Traditional Chinese, Vietnamese, French, German, Spanish, Portuguese, Italian, Indonesian.
- **Tokenise action on the workspace graph.** Right-click any node and run *Tokenise* to add a derived `__derived__.tokens` column using Lindera (JA/KO), Jieba (ZH), or whitespace + lowercasing (everything else). Derived columns are first-class graph metadata — they survive clone / filter / slice / concat / join / expression operations and are exposed via the new per-node *Manage derived columns* dialog. The concordance and token-frequency tabs auto-pick the tokens column when present.
- **Concordance search-mode toggle (text / tokens).** A new toggle in the concordance parameter panel switches between substring matching (the previous behaviour, still the default for English-only corpora) and exact-token matching against the derived tokens column. Required for accurate concordance on CJK languages where character-level substring matching is meaningless. The whole-word toggle is automatically suppressed on nodes whose corpus language is CJK.
- **Lindera tokeniser model picker.** When tokenising a JA or KO corpus, choose between `ipadic`, `unidic`, `jumandic` (JA), or `ko-dic` (KO). Dictionaries are fetched on demand from the LDaCA-hosted `SIH/lindera-dicts` registry with matching size hints displayed in the picker.
- **Workspace node colours.** Every node on the workspace graph now carries an X/Y shade pair derived from a 12-colour palette, persisted per workspace in a new `ui_state.json` sidecar so colours survive page reloads and workspace switches. Three visual states (Active / Focus / Unselected) make it clear at a glance which nodes the current analysis tab is operating on. Manual picks via the per-tab colour picker preview before *Run* commits them. Newly-created nodes (from detach / clone / join / stack) get a 3-px black outline until you first interact with them so derivations are easy to find amid many similar grey blocks. See `frontend/docs/developer-guide/node-colour-strategy.md` for the full design.
- **Workspace UI-state backend** (`GET` / `PUT` `/workspaces/{id}/ui-state`). Free-form JSON sidecar persisted alongside the workspace's `metadata.json`, deliberately separate so the docworkspace data model stays free of UI concerns. The frontend currently writes only the assigned colour map; future presentation prefs (column visibility, layout) can land here without a backend release.
- **Multi-language stopword support in topic modelling and token frequency.** The stopword pool now merges per-corpus language-specific lists when multiple languages are present in the working set, and exposes a read-only "view list" of the currently-active stopwords so you can see exactly what's being filtered. Stopword archives are now included in the topic-modelling zip download.
- **Post-fit stopword filter on topic-modelling representative words.** Apply additional stopwords after a topic-modelling run to clean up label words without re-running the embedder. *Words per topic* output now scales up to `max(50, 2 × setting)` so you can inspect a wider tail of representative words after fitting.
- **Sample-data catalogue.** The *Add Sample Data* panel is now a multi-collection picker driven by a remote catalogue (`/api/sample-data/catalogue`). Datasets are downloaded on demand from `ldaca-analytics-sample-data`, so the install size of the app shrinks substantially and the catalogue can grow without a release.
- **Per-source model picker for concordance + token frequency.** When more than one tokenisation exists on the same source node (e.g. you tokenised once with `ipadic` and once with `unidic`), a model dropdown lets you pick which derived column to analyse. The intersection of available models across selected nodes drives the dropdown options.
- **Workspace graph toolbar: batch Delete.** The previous *Save* button — redundant since workspaces autosave — is replaced with a *Delete (n)* action that batch-removes all multi-selected nodes in one call.
- **Workspace graph layout: virtual super-source.** Multiple roots in the same workspace now left-align uniformly via a virtual super-source node, removing the visual staircasing the previous layout produced.

### Changed

- **Concordance KWIC alignment.** Left-context column is now right-aligned and the matched-text column is centred, so the keyword runs as a clean vertical band down the middle of the table.
- **Export panel header.** Shows the workspace **name** instead of the internal UUID, and drops the per-data-block UUID line — the human-readable name plus shape is enough context for the export action.
- **Selected-data-block styling is unified across every analysis tab.** Concordance, token frequency, quotation, sequential analysis, topic modelling, AI annotation, and export now all use the same `NodeSelectionPanel` rendering, with the same colour treatment driven by the global colour store. Previously each tab maintained its own copy and they drifted in font, padding, and palette.
- **Frontend version is baked into the bundle at build time.** `import.meta.env.VITE_APP_VERSION` is now substituted into in-app markdown docs at render time (`{{VERSION}}` / `{{BUILD_DATE}}` placeholders) and shipped as feedback-form context, so the version a user sees always matches the bundle they're running.
- **Detach dialog: derived columns hidden.** `__derived__.*` columns no longer appear in the column pickers for detach (concordance, quotation, topic modelling, AI annotation), in row-detail dialogs, or in exported files. The derived registry remains accessible via the per-node *Manage derived columns* dialog.

### Fixed

- **Derived registry propagation.** Derived columns are now correctly carried across `clone`, `filter`, `slice`, `concat`, `join`, and expression-evaluation operations on docworkspace nodes. Previously, derivations registered on a parent node disappeared from any operation result, so re-tokenising was needed after every preprocessing step.
- **Concordance materialise + page-size probe.** Materialising a concordance result now honours the selected search mode, and the page-size probe tightened so processed-count labels read `min(page_size, corpus_size)` rather than always page_size.
- **AI annotation detach output is materialised** into the workspace data dir alongside the source, so detached annotation blocks survive the workspace artifact-cleanup pass.
- **Topic-modelling detach output is materialised** for the same reason.
- **Topic-modelling re-aggregation slider** no longer overwrites the in-place assignments parquet, so previously-detached blocks remain readable across slider movements.
- **Filter datetime literals are cast to match the column dtype** so timezone-typed datetime columns can be filtered against naive date literals without raising.
- **DerivedColumnsDialog reactively reflects deletions** instead of showing the deleted row until the dialog is closed and re-opened.
- **ResizeObserver overlay suppression** during the analytics tab transitions; the overlay was triggered by a small font remeasure during the token-frequency stacking-breakpoint recalculation.

## [0.2.9] — 2026-05-06

### Added

- **CILogon OIDC authentication.** Multi-user deployments can now sign in with CILogon (AAF-federated) in addition to Google. Configured via `CILOGON_CLIENT_ID` / `CILOGON_DISCOVERY_URL` / `CILOGON_REDIRECT_URI` in the systemd environment.
- **Clear embedding cache** action in the sidebar's *Edit visible views* menu, under *Reset all hints*. Opens a confirmation dialog showing exactly how many cached files and how much disk space will be reclaimed before you confirm.
- **Topic-modelling tutorial section on the embedding cache** explaining what it does, how to clear it, and a tip for big-corpus exploration: pre-run topic modelling on the **full corpus with a small topic number first** (overnight is reasonable). The cache is then primed, and subsequent runs on derived sub-corpora finish much faster as long as you don't clear it.
- **Release-time embedder revision check** (`backend/scripts/check_model_updates.py`). Optional script that compares the pinned HuggingFace revision against the latest upstream and offers to update — defaults to "no", so model versions never change without a deliberate developer decision.

### Changed

- **Embedding cache moved out of `user_data/`.** The on-disk embedding cache used to sit at `<user_root>/user_data/embedding_cache/`, where it appeared in the data-loader file tree even though it isn't user content. It now lives at `<user_root>/user_cache/embeddings/` — invisible to the file browser. Existing files in the legacy location are picked up and removed by the new *Clear embedding cache* button so no manual migration is needed.
- **Topic-modelling sampling now uses the same RNG as the preprocessing slice tool.** Previously, the topic-modelling sampler used Python's `random.Random` while preprocessing used Polars' RNG, so the same `(seed, fraction)` selected different rows in each tool. Now both use `pl.int_range(N).sample(seed=…, fraction=…)`, so identical inputs yield byte-identical row selections.
- **Embedder model pinned to a specific HuggingFace revision** (`sentence-transformers/all-MiniLM-L6-v2 @ c9745ed1…`) rather than implicitly tracking `main`. Reproducibility across deployments and machines; updates are now an explicit, audited developer action.
- **Faster backend startup on Apple Silicon.** The MPS embedder prefetch now probes the HuggingFace cache locally first; when the model is already cached it skips the network HEAD request entirely (~30 ms vs hundreds of ms previously, with no misleading "Downloading…" log line).

### Fixed

- **Topic-modelling re-aggregation no longer breaks previously-detached blocks.** The slider used to overwrite the assignments parquet *in place*, so any block detached at an earlier slider position would silently see new data and could fail with HTTP 500 when read. Re-aggregation now writes to fresh paths and tracks superseded files in the manifest for cleanup, so detached blocks remain valid for the lifetime of their source task.

## [0.2.8] — 2026-05-05

### Changed

- **All tool tutorials rewritten and unified in style** (Topic Modelling, Trends & Sequence, Token Frequency, etc.).
- **Token Frequency UI overhaul:**
  - "Juxtorpus" rename to align with the broader UI vocabulary.
  - Cloud / list view toggle for token frequencies.
  - Reference Data Block selector moved to the footer row for a cleaner main view.

## [0.2.7] — 2026-05-05

The "topic-modelling optimisation" release. Brings the major performance and feature work tracked under the `tm-optimisation` branch.

### Added

- **Per-corpus sampling** with auto-suggested fractions for large datasets (target ≈ 4,000 documents in the working set; a percentage input lets you adjust).
- **Three topic-size modes** in the parameter panel:
  - *Aim Topic No.* — soft target, the model decides cluster sizes.
  - *Min Topic Size* — exact minimum cluster size, model decides count.
  - *Exact Topic No.* — model fits naturally then merges to the requested count, with a slider for post-fit re-aggregation between 2 and the raw count.
- **ONNX-based embedder** for Windows / Linux / Intel Mac — quantised model files, materially faster than the previous PyTorch path.
- **MPS embedder** for Apple Silicon — uses the GPU for ~3× faster cold runs.
- **SHA-256-keyed embedding disk cache** so repeated topic-modelling runs over the same texts skip the embedding stage entirely.
- **Per-chunk progress** during the slow embedding stage (every 10 chunks of 512 docs), so the progress bar moves smoothly instead of pausing for minutes.
- **Online pipeline** (IncrementalPCA + MiniBatchKMeans) available via `force_mode="online"` for very large corpora that don't fit in memory under the classic UMAP+HDBSCAN path.
- **Stop button** that actually cancels a running topic-modelling task by SIGTERM-ing the worker process (new `/tasks/cancel` endpoint), so long runs can be aborted cleanly.

### Fixed

- **Detached-node row indices when sampling.** Detached blocks now correctly map back to the original document positions in the source corpus, even when the topic-modelling run sampled a fraction of the data.

## [0.2.6] — 2026-05-04

### Added

- **Qualtrics feedback survey v2** (`SV_0HrF3tzJBz3lQk6`) with embedded context parameters so feedback can be correlated with the workflow the user was in.

### Fixed

- **Excel (`.xlsx`) export corruption past row 65,530.** xlsxwriter's automatic hyperlink detection was rewriting URL-shaped cells and corrupting large exports — now disabled.

---

[0.4.0]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.4.0
[0.2.9]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.9
[0.2.8]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.8
[0.2.7]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.7
[0.2.6]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.6
