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

When the dispersion view is on **and** bars are *not* set to proportional length, an aggregated chart appears under each table. It shows how matches are distributed across the relative position in documents — x-axis is 0–100 %, y-axis is the count of matches in each percentage bucket. There is one line/bar per matched text, coloured to match the legend; clicking the legend hides those matched texts from the chart too.

The title under the chart follows the pattern *{Data block name}: aggregated matches at relative locations of documents from <scope dropdown>*. The dropdown switches the plot between **page above** (matches on the current page only) and **whole data block** (matches across the entire corpus once Process All — or a dispersion detach — has materialised the cache). Whole-data-block is auto-selected the first time the materialised data is ready, and the dropdown reverts to "page above" if there is no cache yet.

<h4 id="help-concordance-chart-type">Chart type selector</h4>

A **Chart type** dropdown next to the title lets you switch the plot between **Line**, **Bar**, and **Area**. The choice is per-session and applies to every dispersion block on the page.

<h4 id="help-concordance-bin-count">Bin No. selector</h4>

The **Bin No.** dropdown in the dispersion options row controls how many buckets the 0–100 % range is divided into. Allowed values are `4, 5, 10, 20, 25, 50, 100` (default `20`). All counts divide 100 cleanly so the plot can be re-aggregated instantly without another fetch — switching between values is immediate. Hovering a point on the line shows the bucket range (e.g. *0-5 %*, *6-10 %*) along with the count.

Changing **Bin No.** while bins are selected (see [Selecting bins](#help-concordance-bin-selection) below) clears the current selection rather than silently re-mapping bin indices that would no longer point at the same hits.

<h4 id="help-concordance-bin-selection">Selecting bins</h4>

Click any bar (or line/area point) in the chart to select that bin. Shift-click another bin to extend the selection to the range between them. Selected bins are highlighted; unselected bins fade to ~25 % opacity. The **Clear Selection** button to the left of the **Bin No.** selector deselects everything.

When at least one bin is selected, the **Add to Workspace** button shows the bin count and detaches only the matches falling inside the selected bins (see [Add to Workspace](#help-concordance-detach)).

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

Process All happens automatically as a side-effect the **first** time you click **Add to Workspace** from the dispersion view without a bin selection — the slow-path detach has to read every hit anyway, so the cache is written along the way. The button flips from **Process All** to **Processed** and the chart's scope dropdown gains the **whole data block** option, all without an extra click.

<h3 id="help-concordance-process-both">Combined view: Process Both</h3>

![Combined view buttons](tutorials/assets/concordance/combined_view_buttons.png)

In Combined view, the per-block Process All button is replaced by **Process Both**. It iterates the two selected data blocks and materialises any that aren't already cached — clicking it after only one block has been processed will just process the missing one (already-materialised blocks are skipped). The button label states are equivalent to Process All:

- **Process Both** — at least one block still needs processing.
- **Processing…** — at least one materialise task is currently running.
- **Processed** — both blocks are materialised; the button is disabled.

When the search term changes and you click **Update**, the cache for both blocks is cleared and the button reverts to **Process Both**.

<h3 id="help-concordance-detach">Add to Workspace</h3>

![Concordance detach screenshot](tutorials/assets/concordance/detach_datablocks.png)

The **Add to Workspace** button extracts results as a new derived data block in the workspace. Two different output shapes apply depending on the view:

- **Table view** — one row per hit. The detached block is named *originalName*_conc.
- **Dispersion view** — one row per source document. Matches inside the document are collected into list columns (`CONC_matched_text`, `CONC_l1`, `CONC_r1`, …) and the raw KWIC windows are joined into a single multi-line string under `CONC_extraction`, with each line prefixed `- ` for Markdown compatibility. The detached block is named *originalName*_conc_aggregated, with a range suffix when a bin selection narrows the output (e.g. `_conc_aggregated_21-40`).

In Combined view both buttons operate across both source blocks at once and produce one detached block per source.

**Bin selection** — if you've selected bins on the dispersion chart, the detach is restricted to hits inside those bins. The button label shows the bin count, e.g. *Add to Workspace (3 bins)*.

**Legend filter** — hidden legend entries (matched texts you've toggled off in the legend) are excluded from the detached block, so the workspace data block always matches what's visible in the chart.

![Concordance detach metadata](tutorials/assets/concordance/detach_metadata.png)

A dialog at the start of the detach lets you pick which optional columns to carry over from the parent block. All optional columns start unticked — opt into the source columns and any generated columns you want. Mandatory columns (the seven core `CONC_*` fields) are emitted automatically and don't appear in the picker.

- **Table view** offers `CONC_extraction` (per-hit raw KWIC window stitched from the source document) as an opt-in tick. The dispersion view's detach always emits `CONC_extraction` as the per-document joined string, so it doesn't appear as a separate pick there.

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
| Add to Workspace is disabled | No results loaded, or all legend entries are hidden | Run the search first; re-enable at least one legend entry if everything is filtered out |
| Process All button is disabled showing **Processed** but I changed the search | The cache was tied to the previous search; it auto-clears on **Update**. | Click **Update** so a new task is created — Process All becomes available again. |
| Scope dropdown stuck on "page above" with no "whole data block" option | Materialisation hasn't run for this block yet | Click **Process All**, or just trigger an **Add to Workspace** from the dispersion view without a bin selection (it materialises as a side-effect) |
| Bin selection vanished when I changed Bin No. | Expected — the selection is cleared when the bucketing changes so older bin indices don't silently re-map onto different hits | Re-select bins under the new bin count |
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
| Chart type (summary plot) | Line | Switch between Line, Bar, Area |
| Sources (Combined view) | Aggregate | Switch to Split for solid/dashed per-source lines |
| Scope dropdown (summary plot) | "page above" | Switches to "whole data block" once a materialise has run; auto-flips to whole-data-block the first time the cache lands |

## Practice exercise

1. Select a data block and search for a common word in your text.
2. Enable **Whole Word** and compare the match count with it off.
3. Enable **Use Regular Expression** and search for two related variants at once (e.g. `[Aa]nalys[ei]`).
4. Switch to the **Dispersion** view tab. Tick **Colour matches** and click an entry in the legend to filter that variant from both the bars and the line plot.
5. Hover over a vertical match line in the dispersion bar to read the surrounding context.
6. Click **Process All** and wait for **Processed**. The scope dropdown next to the chart title flips from *page above* to *whole data block* automatically — the chart now summarises the entire corpus.
7. Try changing **Bin No.** between 10, 20 and 50 to see how the smoothing of the line changes. Also try the **Chart type** dropdown (Line / Bar / Area).
8. Click a bar, then Shift-click another to select a range. Click **Add to Workspace** — note the bin count in the button label. The detached block is per-document, with `CONC_extraction` joining the raw KWIC windows with `- ` bullets.
9. Hide one matched-text from the legend, then click **Add to Workspace** again on the full chart. Verify the new detached block contains only the visible matches.
10. Download the summary plot as PNG and confirm the title, search term and (filtered) legend appear correctly in the image.
11. Add a second data block, switch to **Combined** view, click **Process Both**, then try **Sources: Split (solid/dashed)** to compare distributions across the two corpora.
12. Switch to Trends and Sequence, select the detached concordance data block, and plot the matches over time.

[← Back to tutorial index](./index.md)
