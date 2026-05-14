# Changelog

User-facing changes to the LDaCA Text Analytics Web Application since v0.2.5.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.5] — 2026-05-14

The first changelog entry on the 0.3 line — consolidates work shipped under intermediate tags v0.3.0, v0.3.1, and v0.3.2 along with the changes that follow them. The headline additions are a sample-data catalogue picker (replacing the single-button import), a runtime docs registry, and a sweep of topic-modelling and concordance polish.

### Added

- **Sample-data catalogue.** The single "Import sample data" button is replaced by a panel listing every curated dataset with checkboxes, size, status chip (bundled / downloaded / partial / not_downloaded), tool-recommendation badges, and a per-collection README viewer. Backend serves the catalogue via a new endpoint and proxies each README.
- **Sample data is fetched on demand from a remote repo.** The Reddit datasets no longer ship inside the Python wheel — they're pulled from the `ldaca-analytics-sample-data` repo the first time a user selects them. Cuts ~tens of MB off the install size.
- **Docs registry.** Tool tutorials and reference pages are now loaded at runtime from a versioned remote (`docs/v0.3/...`), with the bundled markdown kept as an offline fallback. Includes a stale-while-revalidate cache + an end-of-life banner that surfaces when a docs version is past its support window.
- **Auto-substituted version + build date in markdown docs.** The references panel now shows the running version and build date via `{{VERSION}}` / `{{BUILD_DATE}}` placeholders that the React markdown renderer resolves from `import.meta.env`, so the docs always match the deployed build.
- **Topic modelling: post-fit stopword filter** for representative words. Hides English/Chinese function words from each topic's word list without re-fitting the model.
- **Topic modelling: post-fit "Words per topic" slider** that can reveal up to `max(50, 2×original_setting)` words per topic. Previously capped at the original setting; the wire payload now carries the full buffer so increasing the slider doesn't require a refit.
- **Topic modelling: detach exports renamed topic words.** When a user has overridden a topic's meaning, the detached node honours that override (`topic_meanings_override`) so the exported labels match what's on screen.
- **Concordance: `CONC_extraction` column** added to detached results, holding the extracted context window for each hit (separate from the dispersion frequency column).
- **Concordance: legend-filtered detach.** When a chart legend filter is active, the detach button now scopes the export to the visible series instead of the full result set.
- **Workspace graph: batch delete with selection count.** The toolbar's Save button is replaced by Delete (N), enabling multi-select deletion of data blocks.
- **Quotation: `QUOTE_extraction` column** with a clearer frontend label, matching the new concordance extraction column.

### Changed

- **Workspace graph layout: roots left-aligned** via a virtual super-source node. Multi-root workspaces no longer have one root drifting to the centre while others left-anchor.
- **Detach dialog: analysis column highlighted + gating.** The column that the analysis was run on is now bolded, and on topic-modelling detach the dialog refuses to proceed until at least one metadata column is picked. Other tools keep the previous "no-gating" behaviour.
- **Concordance UI:** dispersion-view detach button deduplicated; the page-size summary lifted above the pagination row for a calmer footer; document column no longer auto-ticked on dispersion-detach.
- **Sequential analysis:** linear-axis ticks are denser; missing time-group buckets are zero-filled so the line isn't visually broken by sparse groups.
- **Token frequency:** node selector capped at 2 corpora; results pane labelled "Keyword Analysis" to better match what users do with it.

### Fixed

- **Topic modelling: `top_n_words` wire payload was truncated** to the display setting, so the new post-fit Words-per-topic slider couldn't reveal more words even when they existed. The payload now carries the full buffer.
- **Topic modelling: top-n-words count + Chinese stopwords** — backend now serves Chinese stopwords for the post-fit filter, and the `top_n_words` request value is scaled correctly through the pipeline.
- **Concordance:** processed-count label now shows `min(page_size, corpus_size)` instead of overstating the count on small corpora.
- **Concordance:** `CONC_extraction` column is hidden from the dispersion-detach dialog (only meaningful in the table view).
- **Workspace:** data view no longer overflows when a second tab opens.

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

[0.3.5]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.3.5
[0.2.9]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.9
[0.2.8]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.8
[0.2.7]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.7
[0.2.6]: https://github.com/Australian-Text-Analytics-Platform/ldaca_web_app/releases/tag/v0.2.6
