# Changelog

User-facing changes to the LDaCA Wordflow (previously "LDaCA Text Analytics Web Application") since v0.2.5.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.1] — 2026-05-21

Two themes:

1. **Multi-user tokens-cache safety.** A workspace tokenised by user A and shared with user B no longer writes cache parquets into A's folder when B runs analyses — B's cache stays in B's own tree, full stop. Matters for the Nectar multi-user deployment and for any future filesystem where ACLs aren't relied on for separation.

2. **Lazy on-demand tokenisation by default.** The cache is now a *side effect* of analysis (filled lazily on the first collect), not something the user manages explicitly. Tokenise dialog completes instantly; the per-row tokens fill in the bucket parquet on demand under an advisory lock. The Phase 2.5 "repair banner" + cross-machine workspace repair flow is gone, replaced by an automatic plan-time alignment hook that handles cross-user, cross-machine, and cross-OS path differences uniformly.

Plus the usual sweep of analysis polish, copy fixes, and a graph-rendering safety fix that surfaces in PyPI users for the first time via `docworkspace>=0.2.9`.

### Added

- **Concordance: L1/R1 columns now sit adjacent to the match, with duplicates dimmed in-place and a per-column text-colour picker.** New "Hide L1/R1" toggle keeps the tighter table layout available when those columns aren't useful for the current corpus. Picker palette derives from the active node colour and defaults to hidden until the user opts in.
- **Token-frequency: persist last-used language + model to preferences** so re-opening the dialog defaults to whatever the user picked last, not whatever was first in the registry.

### Changed

- **Token-frequency "Reference Data Block" selector renamed to "Study Data Block"** to match the analysis-card language already used elsewhere.
- **Token-frequency: radio order + default reshuffled**, transfer-cache UI hidden (its only consumer was the retired repair banner), XLM tokeniser strip cleaned up.
- **Tokens cache now lives at `{data_root}/<user_data_folder>/<user_dir>/user_cache/tokens/`** — sibling of `embeddings/` and `snapshots/`, inside each user's own folder. The previous `{data_root}/.cache/<user>/tokens/` umbrella was readable by every authenticated user via the data-loader, which on a multi-user host effectively shared raw tokenised document content across accounts.
- **Auto-migrate eager-tokenised workspaces to the lazy form on load.** v0.5.0 and earlier workspaces that contain pre-materialised tokens columns are rewritten on first open; no user-visible action required.
- **Tokens cache: opportunistic compaction.** Per-bucket delta parquets roll up to a single base parquet in the background once the threshold is crossed, capped per call so it never blocks `tokenise_column`. Triggers on each tokenise call and at backend startup.

### Fixed

- **Workspace-load alignment for cross-user-imported workspaces.** Opening a workspace whose lazy tokens expression was baked under another user's cache path now scrubs and re-stamps the expression under the current user's identity at load time. Path comparison (not user-id comparison) also catches single-user → multi-user migrations and cross-OS path-normalisation cases. Best-effort: a single bad node logs and skips rather than blocking the whole load.
- **Manage Tokens · Delete now actually removes the underlying lazy expression.** Previously `LazyFrame.drop()` only hid the column from the schema; the `tokenize_with_cache_lookup` plugin call stayed alive in the serialised plan, accumulating dead expressions across re-tokenisations and (in shared workspaces) firing writes to the original author's tree. Both the user-triggered delete and the implicit re-tokenise replace now use `polars_text.scrub_plugin_expressions` so `.plbin` plans stay minimal.
- **One broken node no longer breaks the workspace graph endpoint** (`docworkspace>=0.2.9`). A failing `Node.info()` (e.g. source parquet moved or deleted) now returns a per-node error envelope while sibling nodes render normally; previously the whole graph view 500'd. Already in source-checkout users since v0.5.0; this release brings it to `pip install` users too.
- **Python and Rust now resolve the tokens-cache directory the same way.** Previously each could fall back to a different default path when `LDACA_TOKENS_CACHE_DIR` was unset; the backend startup hook now sets the env unconditionally, and the manifest writes / cache parquet writes always land in the same directory.
- **Mojibake repair at the data-loader boundary.** UTF-8 strings that were re-encoded through CP-1252 (the classic "Ã©" / "â€™" garbage) are detected and repaired on load via `ftfy`, gated to the encoding fixers only so the repair is safe on CJK / Arabic / Cyrillic corpora.
- **SentencePiece tokens no longer carry the leading `▁` prefix** when read back from cache — the strip happens at cache-write time so historical caches re-read cleanly too.
- **Token-frequency: %DIFF + LogRatio formulas aligned with the Lancaster wizard** so cross-tool keyness comparisons agree to the published reference.
- **Concordance dispersion detach: embedded newlines stripped** from the extract text so the detached node's preview table stays one row per hit.
- **Graph: data-block rename commits on blur**, not just on Enter — same behaviour the rest of the app already has.
- **Graph: ResizeObserver attached via callback ref** so it actually fires on first mount in some browsers.
- **Concordance: search-mode override clears when tokens become unavailable** (e.g. after deleting the source's derived tokens column).
- **Docs: tutorial modal stays open when an in-doc anchor is missing** instead of closing silently.
- **Node colour assignment excludes grey** from both the random and positional auto-assign paths — grey is reserved for the "disabled" semantic.
- **TanStack table no longer warns about "deeply nested keys"** for derived columns whose names contain dots — `accessorFn` replaces the dotted `accessorKey` so the table reads the field literally.
- **CI verify-versions gate works on a fresh checkout.** The workflow now uses recursive submodule checkout, so the version-drift check sees the same five sources the bumper writes.

### Security

- **Dependabot alerts cleared.** Backend Python deps and frontend Tauri / bytes / postcss bumped to versions without open advisories.

## [0.5.0] — 2026-05-17

Demo snapshots: save a frozen view of any analysis to a small `.ldaca-snapshot` bundle, then re-open it later (or share with a collaborator) without re-running the analysis. Snapshots ship with the dataset rows, parameters, and chart state required to re-render exactly what was on screen. Every one of the five analysis tools — Concordance, Quotation, Trends, Token Frequency, Topic Modelling — now has Save / Open buttons in its header and a banner-flagged read-only viewer for loaded snapshots.

Trends snapshots are the headline: they're saved as **data-rich captures** so the viewer can re-aggregate locally. Pick the finest time bin and up to 3 group-by columns at save time; the viewer then coarsens frequency, drops group dimensions, and case-folds legends — all without a backend round-trip.

Docs branch flips from `v0.4` → `v0.5`; in-app docs panel reads from the matching documentation tag automatically.

### Added

- **Demo Snapshot view across every analysis tool.** Each of Concordance, Quotation, Trends, Token Frequency, and Topic Modelling now has a Save Snapshot / Open Snapshot pair in its parameter card header. Saved bundles are `.ldaca-snapshot` zips containing the result rows, the parameters that produced them, a manifest with capabilities + version compatibility info, and (optionally) a markdown description. Loading puts the analysis card into snapshot mode — a banner identifies the loaded snapshot and an "Exit" button returns to live view.
- **Trends client-side re-aggregation.** Trends snapshots are captured at the user-chosen finest time bin and up to 3 group columns (string / categorical only). The viewer re-aggregates with `sequentialRebucket.ts` — pick any frequency coarser-or-equal to the captured bin, drop any group dimensions, toggle case-folding on legend values, all locally without re-hitting the backend. 22 golden tests pin bucket boundary semantics to polars (Monday-start ISO week, quarter on Jan/Apr/Jul/Oct).
- **Trends snapshot configuration dialog.** A custom Save dialog asks for finest time bin, group-by columns (with real per-column cardinality counts via `nodesApi.uniqueValues`), and a numeric bin origin/step on the numeric path. A row-count estimator runs continuously; when the estimate creeps past half the 200 000-row hard cap, a "Verify actual row count" button surfaces and runs a backend dry-run through the new `/sequential-analysis/preview` endpoint (which sidesteps the live task slot).
- **Demo snapshots import tab in the Sample Data dialog.** Snapshots bundled with the sample-data repo's `demo_snapshots/` catalogue appear in a new tab in the Sample Data import dialog; pick one to download to your local snapshots folder. Conflicts skip-by-default with an explicit "Replace" opt-in.
- **Token-frequency post-fit controls active in snapshot view.** Stop-words filter, cloud/list display limits, and the sort button stay live in snapshot mode — they're all frontend-side projections, so they re-render the captured rows without needing a fresh fit. The same `persistEnabled` flag pattern is documented in `docs/snapshot-view/playbook.md` for future tools.
- **Topic-modelling post-fit slider in snapshot view.** "Words per topic" stays adjustable in snapshot mode, up to the words-per-topic cap that was stored at fit time (`max(50, fit_value * 2)`).
- **Concordance dispersion: per-document grouping at materialise time.** Replaces the previous "one bar per hit" layout, which exploded large multi-hit documents to dozens of bars.
- **Dtype normalisation on load.** Mixed-precision integer / float / datetime columns are normalised to a canonical profile (Int64 / Float64 / Datetime[μs, UTC] / Utf8) at load time, with one consolidated warning per file listing what got promoted. Workspace save / reopen no longer fails for `Int8`/`Int16` columns produced by some sample-data feeds.
- **`/workspaces/nodes/{node_id}/sequential-analysis/preview` backend endpoint.** Stateless aggregation that bypasses task registration + slot conflict checks. Used by the snapshot capture path (`include_data=true`) and the dry-run row estimator (`include_data=false`). Live users are unaffected — their task slot remains intact across capture flows.
- **Centralised `SNAPSHOT_DISABLED_REASON` tooltip.** Every read-only control in snapshot mode now surfaces the same hover hint ("Disabled in snapshot view — exit demo mode to use this control.") via `<DisabledReasonTooltip>`, with no native `title=` 1–2 s delay.

### Changed

- **In-app documentation now reads from the `v0.5` branch of `ldaca-wordflow-docs`.** `VITE_DOCS_BASE_URL` points at `.../ldaca-wordflow-docs/v0.5`; the gh-pages publish workflow auto-publishes each `v*.X` branch under its own subdirectory. Bookmarks against old URLs still work — `v0.4` content remains live and matched the previous release.
- **Demo-snapshot save eligibility caps each selected data block at 2 000 rows.** Snapshots aim to be small, shareable, and self-contained; the cap is enforced both client-side (Save button greys out with a tooltip) and at capture time. Trends raises the cap to 200 000 rows on captured output, since its viewer re-aggregates from a data-rich payload.
- **Trends min-group-size filter now reads the viewer's chosen group-by columns in snapshot mode** (previously it compared against the captured columns, so re-grouping or removing dimensions in the viewer caused every series to fail the size check and the chart to read "No groups meet the current minimum group size").
- **Trends group-by column picker filters to string / categorical types only** in the snapshot save dialog — picking a float / datetime / list column would otherwise inflate the captured row count past the hard cap.
- **Topic-modelling "Words per topic" snapshot tooltip mirrors the actual stored cap** (`max(50, fit_value * 2)`) instead of the user's fit-time pick. Tooltip and slider now agree.

### Fixed

- **Controlled / uncontrolled Select warning in the Trends group-by panel.** The empty-string column slot stays controlled instead of flipping to `undefined` after the first pick.
- **`UniqueValueCount` no longer flashes a red "Error" badge** when the unique-values query fails. The pill is a nice-to-have hint; common failure modes (snapshot view where the captured node isn't live-queryable, transient backend hiccup) now silently render nothing instead.
- **Concordance dispersion summary line restored in separated view + snapshot view.** "Found N instances in M documents..." now appears regardless of which dispersion view mode is active.

## [0.4.4] — 2026-05-15

Re-stamps v0.4.3. The code is byte-identical to v0.4.3, but three version sources were missed in the v0.4.3 bump (`frontend/package.json`, `frontend/src-tauri/tauri.conf.json`, `frontend/src-tauri/Cargo.toml`), with the result that:

- Desktop MSI / DMG filenames on the v0.4.3 GitHub release said `0.4.2`.
- The desktop binary's "About" / "Installed apps" `productVersion` field said `0.4.2`.
- The in-app version display (`VITE_APP_VERSION` baked into the FE bundle, surfaced in the in-app docs and on feedback-form submissions) said `0.4.2`.

`pip show ldaca-wordflow` correctly reported `0.4.3`, so users hitting the `pip` path got a self-contradictory pair of version strings. v0.4.4 ships the same code with all five version sources aligned. **If you installed v0.4.3 desktop builds, please re-download v0.4.4 to get correctly-labelled bundles**; if you `pip install`'d v0.4.3, upgrading is cosmetic only (no code differences).

A follow-up task is tracked to consolidate the five version sources behind a single source of truth so this drift can't recur.

## [0.4.3] — 2026-05-15

CJK performance + multilingual UX polish. Driven by a hands-on Japanese-corpus test pass on top of v0.4.2: every change closes a friction point that showed up while running real Lindera-tokenised data through the concordance, token-frequency, and dispersion tools. The headline is the per-user tokens cache — re-tokenising a column you already processed is now near-instant, even after a backend restart.

### Added

- **Tokens cache (per user).** Tokenisation results are now persisted in a content-addressed parquet cache at `<user_root>/user_cache/tokens/` and looked up by `(text, tokeniser, model)` hash. Re-running *Tokenise* on the same column — or running it across sub-corpora that share rows — completes in a fraction of the time of the first run. The cache survives backend restarts, and is swept on workspace delete, node delete, derived-column delete, and at backend startup so it never leaks orphans.
- **Concordance tokens-mode: multi-keyword search.** Tokens-mode now accepts multiple alternatives separated by space, comma, or `|` — e.g. `猫|犬|魚` or `cat dog fish` — and returns hits for any of them, in token order. Each alternative is still an exact-token match (not substring), so CJK results stay clean. The placeholder in the search box and the toggle tooltip both explain the new syntax.
- **Mismatch nudge when the wrong column was tokenised.** When the column you've picked for analysis has no derived tokens but a *different* column on the same node does, the analysis panel now shows an amber notice listing the existing tokens columns. Prevents the common "I tokenised ID instead of context" foot-gun that quietly forces the analysis tools back onto whitespace tokenisation against tens of thousands of non-language values.
- **Dispersion summary legend: per-text counts.** Legend items in the concordance dispersion summary now carry `(n)` after each label — the total hits contributed by that source across the whole displayed graph. When you brush-select a region of the plot, every label switches to `(m/n)` where `m` is the per-source count inside the selection. Hidden items keep their number frozen instead of recomputing to zero, so the count reflects the underlying weight of the filter you just turned off.

### Changed

- **Concordance dispersion view groups hits by document.** Previously each hit drew its own bar, so a document with twenty hits became twenty rows. The dispersion view now collapses consecutive same-document hits into a single bar per document, matching what users expect for cross-document distribution analysis. The grouping runs at materialise time on the document column carried through the source node.
- **Word cloud sizing is responsive.** The single-token and unified-token word clouds now measure their container with `ResizeObserver` and feed the live width into the d3-cloud layout. Font envelopes scale as a fraction of canvas width (clamped on both ends), so the cloud fills wide panels without overflowing on narrow ones — the "too much white margin" and "cuts off the longest word" cases both go away.
- **Token-frequency Tokenise / Stopwords panels are React.memo'd.** Typing in the stopword textbox no longer triggers a re-layout of the d3-cloud spiral on every keystroke; the heavy section components only re-render when their inputs actually change.

### Fixed

- **`token_frequencies_task() got an unexpected keyword argument 'node_token_streams'`.** The worker wrapper now forwards the kwarg through to the run function, so token frequencies across two tokenised corpora no longer regress to an error.
- **Tokens-cache race on rapid delete + recreate.** Previously the cache rewrote a single parquet file with `os.replace`, which could race with a concurrent `scan_parquet` re-opening the file for page reads and surface as `parquet: File out of specification: The page header reported the wrong page size`. The cache now writes append-only delta files (LSM level-0 style) with opportunistic compaction; deltas are immutable so the read path can never observe a half-written file.
- **Dispersion detach button surfaces its own gate.** The "Add to workspace" / detach button in the dispersion view is disabled until the corpus is materialised (Process All) when a bin selection is active. The reason was previously hidden because native HTML `title` attributes don't fire on disabled buttons in macOS Safari/Chromium; the button is now wrapped in `DisabledReasonTooltip` so hover reveals "Materialise the corpus first (Process All) to safely apply this bin selection across all documents."

## [0.4.2] — 2026-05-15

The rename release. PyPI package, Python module, GitHub repo, and Tauri product name all flip from `ldaca-web-app` / `LDaCA Text Analytics` to `ldaca-wordflow` / `LDaCA Wordflow`. The behaviour of the app is unchanged from v0.4.1 — this release exists solely to land the rename in a single tagged commit.

### Changed

- **PyPI primary name is now `ldaca-wordflow`.** `pip install ldaca-wordflow` is the new install path. A one-shot legacy shim `ldaca-web-app==0.4.2` is also published; it pulls in `ldaca-wordflow==0.4.2` as its sole dependency, so existing `pip install ldaca-web-app` invocations keep working transparently. Future releases (0.5.0+) ship only to `ldaca-wordflow`.
- **Python module: `ldaca_web_app` → `ldaca_wordflow`.** Update any downstream code that does `from ldaca_web_app import ...` to `from ldaca_wordflow import ...`.
- **Console script: `ldaca-wordflow` is the canonical command.** The previous `ldaca-web-app` command remains as a back-compat alias on the same entry point, so existing systemd units and scripts keep working without edits.
- **Docs URL.** The runtime documentation panel now resolves against `australian-text-analytics-platform.github.io/ldaca-wordflow-docs/v0.4/` (renamed from `ldaca-analytics-docs`). GitHub Pages does NOT auto-redirect for the docs site, so anyone deep-linking the old URLs will hit 404s — update bookmarks.
- **Tauri productName.** Desktop builds now bundle as "LDaCA Wordflow" instead of "LDaCA Text Analytics". The Tauri bundle identifier (`au.edu.ldaca.text-analytics`) is **unchanged** to preserve in-place app updates on installed machines.
- **GitHub repo names.** `Australian-Text-Analytics-Platform/ldaca_web_app` → `ldaca-wordflow`; `…/ldaca-analytics-docs` → `…/ldaca-wordflow-docs`. GitHub auto-redirects keep cloned working trees and existing PR / issue links functional.

## [0.4.1] — 2026-05-15

PyPI hot-fix for v0.4.0. The 0.4.0 wheel declared `docworkspace>=0.2.7` but the published 0.2.7 wheel didn't include the derived-column registry that the multilingual stack depends on, so end users installing via `uvx ldaca-web-app==0.4.0` hit `AttributeError` on the tokenise / concordance-tokens-mode / CJK topic-modeling paths. 0.4.1 raises the floor to `docworkspace>=0.2.8` (the just-released docworkspace wheel that ships the registry) and drops the local `tool.uv.sources` path-source override that masked the bug during release validation.

### Fixed

- **`docworkspace>=0.2.8`** — pulls in the derived-column registry that the v0.4 multilingual flows need (`Node.derived` dict + per-column metadata, propagated through clone / filter / slice / concat / join / expression).

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

[0.4.2]: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/tag/v0.4.2
[0.4.1]: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/tag/v0.4.1
[0.4.0]: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/tag/v0.4.0
[0.2.9]: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/tag/v0.2.9
[0.2.8]: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/tag/v0.2.8
[0.2.7]: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/tag/v0.2.7
[0.2.6]: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/releases/tag/v0.2.6
