<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-concordance-section">Concordance tutorial</h1>

Concordance searches one or two Data Blocks for a word or phrase and shows each
match in context. It is useful for comparing how terms are used and where they
appear within documents.

<h2 id="help-concordance-parameters">Parameter panel</h2>

<h3 id="help-concordance-data-block">Step 1 — Select your data</h3>

Add up to two Data Blocks and choose the source text column for each one. A
fresh selector initializes that choice from the Data Block's saved Document
Column Preference when it has one.

<h3 id="help-concordance-search-term">Step 2 — Enter a search term</h3>

Enter the word, phrase, or token alternatives to find. Each result includes the
left context, matched text, right context, and any source metadata columns you
choose to display.

<h4 id="help-concordance-search-mode">Search mode</h4>

- **Text** searches the original text column. Whole-word, regular-expression,
  and case-sensitive options apply in this mode.
- **Tokens** performs exact-token matching. Separate alternatives with spaces,
  commas, or `|`.

Tokens mode requires a tokenizer model for every selected Data Block. The
selector saves each model as that Data Block's Tokenizer Preference, separately
from its Document Column Preference. When all selected Data Blocks have a saved
model, a fresh selector starts in Tokens mode unless you explicitly choose Text.

Running records the exact source columns, tokenizer mapping, and search mode in
the immutable Analysis request. Reopening an existing Analysis uses those saved
values even if the current Data Block preferences have since changed.

<h5 id="help-concordance-regex-toggle">Regular expressions</h5>

In Text mode, enable **Use Regular Expression** for pattern matching.

| Pattern | What it matches |
|---|---|
| `child(ren)?` | *child* or *children* |
| `tax\|budget\|welfare` | Any one of the three words |
| `#\w+` | Any hashtag |
| `\w{2}-\d{4,6}` | IDs such as *SA-3988* or *id-4589* |

Use [regexr.com](https://regexr.com/) to test unfamiliar patterns. **Whole
Word** excludes partial-word matches, and **Case Sensitive** keeps letter case
distinct.

<h3 id="help-concordance-context">Step 3 — Set the context window</h3>

**Left context** and **Right context** control how many tokens appear around a
match. Both default to 10 and accept values from 0 to 50.

<h3 id="help-concordance-batch-size">Step 4 — Choose documents per batch</h3>

Concordance Results are page-based. **Documents per batch** controls how many
source documents the current page evaluates: 10, 20, 50, 100, 200, 400, or
800. A page can contain fewer visible rows because documents without a match
are omitted, while a document with several matches contributes several rows.

The footer reports the matches and matching documents found after processing
the current source-document batch. An empty page does not mean later pages are
empty.

<h2 id="help-concordance-run">Step 5 — Run or re-run</h2>

Click **Run** to create the Analysis. After a run, change the parameters and
click **Re-run** to replace the Tab's current Analysis with a new immutable
request. Page navigation and sorting do not re-run the Analysis; they query the
completed run's retained input snapshot.

<h2 id="help-concordance-results">Result panel</h2>

The initial Result page is stored with the successful Analysis. Later pages,
page sizes, and source-metadata sorts are projections over the same retained
snapshot. They never read the current mutable Data Block, so editing a source
after a run cannot silently change that historical Analysis.

Generated `CONC_*` columns describe computed matches and are not sortable.
Source metadata headers are sortable in separated per-Data-Block tables.

<h3 id="help-concordance-views">Table and dispersion views</h3>

<h4 id="help-concordance-table-view">Table view</h4>

Table view shows one row per match. Click a row to inspect the full source
document and its metadata. Use the metadata selector to add source columns to
the table.

<h4 id="help-concordance-dispersion-view">Dispersion view</h4>

Dispersion view groups the current page by source document. Vertical marks show
the relative position of each match within the document. **Bar length
proportional to text length** scales bars by document length; with it off, all
bars use the same width for easier positional comparison.

<h4 id="help-concordance-colour">Colour matches and legend</h4>

Enable **Colour matches** to distinguish different matched strings, especially
for regular-expression or multi-token searches. Click a legend item to hide or
restore that matched text in the current-page bars and summary. **Lowercase
matches** combines case variants for colouring and aggregation.

<h4 id="help-concordance-tooltip">Hover details</h4>

![Hover tooltip on a dispersion bar](tutorials/assets/concordance/dispersion_tooltip.png)

Hover over a match line to see its immediate left context, matched text, and
right context.

<h3 id="help-concordance-summary-plot">Current-page dispersion summary</h3>

![Aggregated dispersion summary plot](tutorials/assets/concordance/summary_plot.png)

When proportional bar length is off, the summary chart aggregates the matches
from the page shown above it into relative-position bins. It is a view of the
current Result page, not a whole-corpus cache.

<h4 id="help-concordance-chart-type">Chart type</h4>

Choose **Line**, **Bar**, or **Area**. This presentation choice applies to the
dispersion blocks in the current session.

<h4 id="help-concordance-bin-count">Bin count</h4>

**Bin No.** divides the 0–100 % document range into 4, 5, 10, 20, 25, 50, or
100 buckets. Changing the count clears selected bins so an old bin index is not
reinterpreted under new boundaries.

<h4 id="help-concordance-bin-selection">Selecting bins</h4>

Click a chart bin to select it; Shift-click another bin to extend the range.
**Clear Selection** removes the filter. When you add dispersion output to the
Workspace, selected bins and visible legend entries become explicit filters on
the child Analysis.

<h4 id="help-concordance-download">Download the plot</h4>

![Plot download dialog](tutorials/assets/concordance/download_dialog.png)

Download the current chart as PNG, SVG, or JPEG. The export reflects the
current binning, legend visibility, and source display.

<h3 id="help-concordance-metadata">Show metadata</h3>

Enable **Show metadata** and select source columns to display beside matches.
With two Data Blocks, common columns and source-specific columns are grouped
and colour-coded. Generated Concordance fields are already part of the Result
and do not become source-metadata sort keys.

<h3 id="help-concordance-display-mode">Separated and combined display</h3>

With two Data Blocks, **Separated** gives each source its own Result block and
sort state. **Combined** interleaves the current pages and colours rows by
source. Combined headers are display-only because one sort order cannot be
applied independently to both source snapshots.

<h4 id="help-concordance-sources-mode">Combined source lines</h4>

![Sources split-by-source line plot](tutorials/assets/concordance/sources_split.png)

In the combined dispersion summary, **Aggregate** pools both Data Blocks.
**Split (solid/dashed)** draws one solid or dashed series per source so their
current-page distributions can be compared.

<h3 id="help-concordance-detach">Add to Workspace</h3>

![Derived Concordance Data Blocks](tutorials/assets/concordance/detach_datablocks.png)

**Add to Workspace** submits a direct Child Analysis of the completed
Concordance Analysis. It uses the parent's immutable request and retained input
snapshot, including its tokenizer mapping; it does not rerun against the
current Data Block preference.

- Table output contains one row per hit and uses the `_conc` name suffix.
- Dispersion output contains one row per source document, aggregates generated
  match fields into lists, and uses `_conc_aggregated` plus a selected-bin range
  when applicable.
- Combined actions create one Derived Data Block per source.

The dialog lets you choose optional source columns. Core generated fields are
included by the child operation; `CONC_extraction` is selectable for per-hit
output and included in aggregated dispersion output. Legend and bin filters are
copied into the child request, so the Derived Data Block reflects those choices.

<h3 id="help-concordance-clear-results">Clear results</h3>

The Tab keeps its current Concordance Analysis and durable Result. **Clear
Results** removes that Analysis and resets the Tab, including after failure or
cancellation. **Re-run** first clears the current Analysis and then submits its
replacement.

<h2 id="help-concordance-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| No results on one page | The current source-document batch has no match | Continue to the next page |
| Tokens mode is unavailable | At least one selected Data Block has no tokenizer | Select a tokenizer model for every input |
| Too many partial matches | Whole Word is off in Text mode | Enable **Whole Word** |
| A regular expression fails | Invalid pattern syntax | Test the pattern on regexr.com |
| A generated header does not sort | `CONC_*` values are computed after source paging | Sort by a displayed source metadata column |
| Add to Workspace is disabled | No completed Result or no selectable output | Run the search and restore any hidden legend entries |
| Results differ from the edited Data Block | You reopened a historical Analysis | Use **Re-run** to submit the current Data Block state |

<h2 id="help-concordance-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Search mode | Text, or Tokens for a fresh fully-tokenized selection | An explicit Text choice is preserved |
| Left / Right context | 10 tokens each | Range 0–50 |
| Whole Word | Off | Text mode only |
| Regular expression | Off | Text mode only |
| Case Sensitive | Off | Text mode only |
| Documents per batch | 20 | Controls source rows evaluated per Result page |
| View | Table | Dispersion summarizes the current page |
| Bin No. | 20 | 4, 5, 10, 20, 25, 50, or 100 |
| Chart type | Line | Line, Bar, or Area |
| Combined source display | Aggregate | Split uses solid/dashed source lines |

## Practice exercise

1. Select a Data Block and run a Text-mode Whole Word search.
2. Compare two source-metadata sort orders without re-running.
3. Switch to Dispersion, change the bin count, and select a bin range.
4. Add the filtered dispersion output to the Workspace.
5. Change the source Data Block, reopen the historical Analysis, and then use
   **Re-run** to compare the new request deliberately.

[← Back to tutorial index](./index.md)
