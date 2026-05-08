<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-concordance-section">Concordance tutorial</h1>

![Concordance screenshot](tutorials/assets/concordance.png)

The Concordance tool searches for a word or phrase in a text collection and displays each match surrounded by its context. This lets you see how a term is actually used — what words precede and follow it, and in what types of documents it appears. You can select up to two data blocks at once for a side-by-side comparison.

<h2 id="help-concordance-parameters">Parameter panel</h2>

<h3 id="help-concordance-data-block">Step 1 — Select your data</h3>

Use the data-block selector to choose which corpus (or corpora) to search. You can select up to two data blocks for a comparative concordance. For each selected block, pick the **text column** to search.

<h3 id="help-concordance-search-term">Step 2 — Enter a search term</h3>

Type the word or phrase you want to study. The search is case-insensitive by default (enable **Case Sensitive** to override). Each match is shown with the surrounding left and right context.

**Regular expressions**

Enable **Use Regular Expression** to search using pattern matching. This lets you find word variants, multiple terms at once, or complex patterns.

| Pattern | What it matches |
|---|---|
| `child(ren)?` | *child* or *children* |
| `tax\|budget\|welfare` | Any one of the three words |
| `#\w+` | Any hashtag |
| `\w{2}-\d{4,6}` | IDs like *SA-3988* or *id-4589* |
| `\w+\sof\s\w+` | Phrases with *of* in the middle — e.g. *right of way* |

Use [regexr.com](https://regexr.com/) to build and test patterns before running them here.

**Other search options**

- **Whole Word** — only matches where the search term appears as a complete word (not as part of a longer word).
- **Case Sensitive** — treat uppercase and lowercase as distinct.

<h3 id="help-concordance-context">Step 3 — Set context window</h3>

The **Left Context** and **Right Context** inputs control how many tokens are shown on either side of the match. The range is 0–50 tokens; both default to 10. Increase the context to see more surrounding text; decrease it for a tighter focus on the match itself.

<h3 id="help-concordance-batch-size">Step 4 — Documents per batch</h3>

The concordance searches documents in pages. The **Documents per batch** dropdown sets how many source documents are processed per page (options: 10, 20, 50, 100, 200, 400, 800). Larger batches show more results per page but may take longer to load.

The pagination footer shows **Documents searched / N matches found**, telling you how many source documents were searched on the current page and how many matches they produced. If a search term is uncommon and no documents on the current page contain it, the results for that page will be empty — continue to the next page.

<h2 id="help-concordance-run">Step 5 — Run the search</h2>

Click **Run** to start the concordance search. The button changes to **Update** once results exist; change the search term or settings and click **Update** to re-run. Updating the search creates a new analysis task and clears any previously cached "Process All" outcome (see [Process All](#help-concordance-process-all)) — re-run only when you actually want fresh results, since you'll need to re-process to get whole-corpus aggregation again.

<h2 id="help-concordance-results">Result panel</h2>

<h3 id="help-concordance-views">View modes — Table view and Dispersion view</h3>

Switch between the two view modes via the tabs in the results header. The selection is local to the session and resets when you change tabs.

<h4 id="help-concordance-table-view">Table view</h4>

![Table view screenshot](tutorials/assets/concordance/table_view.png)

Each row represents one match. If a document contains multiple matches, each appears as a separate row. Optionally, select metadata columns to display alongside the match using the column picker — see [Show metadata](#help-concordance-metadata) below.

<h4 id="help-concordance-dispersion-view">Dispersion view</h4>

![Dispersion view screenshot](tutorials/assets/concordance/dispersion_view.png)

Each row represents one document, and all matches within that document are plotted as vertical lines on a horizontal bar. The position of each line shows the relative location of the match within the document.

**Bar length**

By default every bar is the same length so positions can be compared visually across documents. Toggle **Bar length proportional to text length** to scale each bar by the character length of its document — useful for getting a sense of relative document sizes alongside match positions.

<h4 id="help-concordance-colour">Colour matches and legend</h4>

![Coloured dispersion bars with legend](tutorials/assets/concordance/colour_matches.png)

When the search returns multiple distinct matched strings (most often via a regex pattern), tick **Colour matches** to colour each occurrence by which exact text it matched. A legend appears between the bars and the aggregated summary plot listing every matched text in its assigned colour. The legend is shared by both the bars and the line plot.

- **Click a legend entry** to hide that matched text from both the bars and the plot. The entry is dimmed and struck through; click again to bring it back.
- Tick **Lowercase matches** to fold case variants together — e.g. *Hello* and *hello* aggregate as a single legend entry rather than two.

<h4 id="help-concordance-tooltip">Hover tooltip on matches</h4>

![Hover tooltip on a dispersion bar](tutorials/assets/concordance/dispersion_tooltip.png)

Hover over any vertical match line in the dispersion bar to see a small tooltip with the immediate left context, the matched text (rendered in the same colour as the bar), and the right context — equivalent to the row a Table view would show, but reachable directly from the dispersion plot.

<h3 id="help-concordance-summary-plot">Aggregated dispersion summary plot</h3>

![Aggregated dispersion summary plot](tutorials/assets/concordance/summary_plot.png)

When the dispersion view is on **and** bars are *not* set to proportional length, an aggregated line plot appears under each table. It shows how matches are distributed across the relative position in documents — x-axis is 0–100 %, y-axis is the count of matches in each percentage bucket. There is one line per matched text, coloured to match the legend; clicking the legend hides those matched texts from the plot too.

<h4 id="help-concordance-bin-count">Bin No. selector</h4>

The **Bin No.** dropdown in the dispersion options row controls how many buckets the 0–100 % range is divided into. Allowed values are `4, 5, 10, 20, 25, 50, 100` (default `20`). All counts divide 100 cleanly so the plot can be re-aggregated instantly without another fetch — switching between values is immediate. Hovering a point on the line shows the bucket range (e.g. *0-5 %*, *6-10 %*) along with the count.

<h4 id="help-concordance-download">Download the plot</h4>

![Plot download dialog](tutorials/assets/concordance/download_dialog.png)

Use the download button at the top-right of the summary plot to export it as a PNG, SVG, or JPEG. The exported image includes the data block name, the search term, the bin count, and the legend — with hidden legend entries rendered faded and struck through, so the image always reflects the on-screen filter state.

<h3 id="help-concordance-metadata">Show metadata</h3>

![Metadata dropdown sections](tutorials/assets/concordance/metadata_sections.png)

Tick **Show metadata** to display extra columns from the source data block alongside each match. The column picker offers checkbox toggles for every available metadata column.

When **two** data blocks are selected, the picker is grouped:

- Common columns (present in both blocks) appear first, in default colour.
- Below a divider, columns that exist in only one block are listed in their own section, with text tinted to that block's colour. The colour matches the swatch in the data-block panel above the parameter form, so you can tell at a glance which block a column came from.

When the two blocks have identical metadata (or only one block is selected), the picker is a flat list with no sections.

<h3 id="help-concordance-display-mode">Separated and combined display</h3>

When two data blocks are selected, choose between **Separated** mode (each data block shown in its own section, with its own dispersion bars and summary plot) and **Combined** mode (results interleaved, with the row background colour indicating its source data block). The choice is persisted alongside the result.

<h4 id="help-concordance-sources-mode">Combined view: Sources Aggregate / Split</h4>

![Sources split-by-source line plot](tutorials/assets/concordance/sources_split.png)

In Combined view a **Sources:** dropdown appears in the dispersion options row with two choices:

- **Aggregate** *(default)* — hits from both data blocks are pooled into a single distribution line per matched term.
- **Split (solid/dashed)** — every matched term gets two lines: a solid line for the first source data block and a dashed line for the second. A small key under the chart shows which dash style maps to which source. This is useful for spotting whether the two corpora use the term in different positions of their documents.

The Sources selector is independent of **Colour matches** — split-by-source still works when colouring is off (in that case all lines are drawn in the same default colour, just solid vs dashed).

<h2 id="help-concordance-process-all">Process All — full-corpus dispersion</h2>

![Process All button states](tutorials/assets/concordance/process_all_button.png)

By default, the dispersion view and its summary plot only reflect the **current page** of source documents. The pagination footer is the source of truth — what you see is what was loaded for that page.

Click **Process All** to materialise every match across the entire corpus to a backend cache. While the task is running the button shows **Processing…**; when it finishes it shows **Processed** and is disabled. The cache stays valid until the search parameters change.

<h3 id="help-concordance-all-processed">"All processed" toggle on the summary plot</h3>

![All processed toggle](tutorials/assets/concordance/all_processed_toggle.png)

Once Process All has completed, the summary plot's toolbar gains an **All processed** checkbox (auto-ticked the first time materialisation finishes). It switches the plot's data source between:

- **Off** — the plot summarises matches from the **current page** only. The title under the chart reads *Aggregated matches of the documents above*.
- **On** — the plot summarises matches across the **entire materialised corpus**. The title reads *Aggregated matches of data block - {name}*.

While the materialised counts are still being fetched, the toggle label briefly reads *(loading…)*; once the data lands, the suffix disappears and the plot updates.

<h3 id="help-concordance-process-both">Combined view: Process Both</h3>

![Combined view buttons](tutorials/assets/concordance/combined_view_buttons.png)

In Combined view, the per-block Process All button is replaced by **Process Both**. It iterates the two selected data blocks and materialises any that aren't already cached — clicking it after only one block has been processed will just process the missing one (already-materialised blocks are skipped). The button label states are equivalent to Process All:

- **Process Both** — at least one block still needs processing.
- **Processing…** — at least one materialise task is currently running.
- **Processed** — both blocks are materialised; the button is disabled.

When the search term changes and you click **Update**, the cache for both blocks is cleared and the button reverts to **Process Both**.

<h3 id="help-concordance-detach">Add to Workspace</h3>

![Concordance detach screenshot](tutorials/assets/concordance/detach_datablocks.png)

The **Add to Workspace** button extracts the full search results as a new derived data block in the workspace. The detached block is automatically named *originalName*_conc and can be renamed later. In Combined view the button is **Add Both to Workspace** and creates a derived block per source.

![Concordance detach metadata](tutorials/assets/concordance/detach_metadata.png)

At the start of the detach process, a dialog lets you choose which metadata columns from the parent data block to carry over. Consider your downstream analysis needs when making this selection — for example, include a date column if you plan to use the detached block in Trends and Sequence.

If a block has already been processed via Process All, the detach reuses the cached results, which is faster than recomputing them.

<h3 id="help-concordance-clear-results">Clear results</h3>

Concordance results are saved in the backend so the tab can reload and preserve your last results. **Clear Results** removes the cached result from the backend and resets the tab. Clearing also discards any Process All caches associated with that task.

<h2 id="help-concordance-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| No results on a page | Search term absent in documents on this page | Navigate to the next page; the term may appear later in the corpus |
| Too many irrelevant partial matches | Whole Word not enabled | Enable **Whole Word** to avoid matching substrings |
| Regex returns an error | Invalid regex syntax | Test your pattern on [regexr.com](https://regexr.com/) first |
| Results differ unexpectedly between runs | Case Sensitive off; term appears in mixed case | Enable **Case Sensitive** to isolate exact capitalisation |
| Add to Workspace is disabled | No results loaded | Run the search first, then detach |
| Process All button is disabled showing **Processed** but I changed the search | The cache was tied to the previous search; it auto-clears on **Update**. | Click **Update** so a new task is created — Process All becomes available again. |
| "All processed" toggle stuck on *(loading…)* | Slim positions fetch hasn't returned yet, or the backend lost the cache | Wait a few seconds; if it persists, click **Update** then **Process All** again |
| Two-block summary plot shows only matches from one block in Split mode | The other block isn't materialised yet | Click **Process Both** in the Combined header |
| Legend item doesn't visibly hide a line on the plot | The line is hidden but you may have many lines stacked at zero | Check that the y-axis scale is appropriate; legend filters work, but lines plotted as zero may visually coincide with the baseline |

<h2 id="help-concordance-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Left / Right context | 10 tokens each | Range 0–50 |
| Whole Word | Off | Enable to avoid partial matches |
| Use Regular Expression | Off | — |
| Case Sensitive | Off | — |
| Documents per batch | 20 | Larger batches show more per page |
| View mode | Table | Switch via the View tabs |
| Bar length proportional | Off | Toggle in dispersion view |
| Colour matches | Off | Tick to colour by matched text and show the legend |
| Lowercase matches | Off | Tick under Colour matches to fold case variants |
| Bin No. (summary plot) | 20 | Allowed: 4, 5, 10, 20, 25, 50, 100 |
| Sources (Combined view) | Aggregate | Switch to Split for solid/dashed per-source lines |
| All processed (summary plot) | Off until Process All completes | Auto-ticked on first materialisation |

## Practice exercise

1. Select a data block and search for a common word in your text.
2. Enable **Whole Word** and compare the match count with it off.
3. Enable **Use Regular Expression** and search for two related variants at once (e.g. `[Aa]nalys[ei]`).
4. Switch to the **Dispersion** view tab. Tick **Colour matches** and click an entry in the legend to filter that variant from both the bars and the line plot.
5. Hover over a vertical match line in the dispersion bar to read the surrounding context.
6. Click **Process All** and wait for **Processed**. Watch the **All processed** toggle appear on the summary plot's toolbar — toggle it on and observe the title and line shape change as the plot switches from page-level to whole-corpus aggregation.
7. Try changing **Bin No.** between 10, 20 and 50 to see how the smoothing of the line changes.
8. Download the summary plot as PNG and confirm the title, search term and (filtered) legend appear correctly in the image.
9. Add a second data block, switch to **Combined** view, click **Process Both**, then try **Sources: Split (solid/dashed)** to compare distributions across the two corpora.
10. Click **Add Both to Workspace** to detach the results as derived blocks; include any date or speaker metadata columns.
11. Switch to Trends and Sequence, select the detached concordance data block, and plot the matches over time.

[← Back to tutorial index](./index.md)
