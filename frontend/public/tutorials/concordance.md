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

Preview records the exact source columns, tokenizer mapping, and search mode in
the immutable Analysis request. Reopening an existing Preview Analysis uses
those saved values even if the current Data Block preferences have since
changed.

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

<h3 id="help-concordance-batch-size">Step 4 — Choose documents per page</h3>

Concordance Preview is document-paged. **Documents per page** controls how many
source documents the current page evaluates: 10, 20, 50, 100, 200, 400, or
800. A page can contain fewer visible rows because documents without a match
are omitted, while a document with several matches contributes several rows.

The footer reports the matches and matching documents found after processing
the current source-document batch. An empty page does not mean later pages are
empty.

<h2 id="help-concordance-run">Step 5 — Preview</h2>

Click **Preview** to create a durable Preview Analysis. After changing a
parameter, click **Update Preview** to replace it with a new immutable request.
Each page navigation or sort request recomputes that page from the retained
input snapshot. Preview pages are not retained or reused.

<h2 id="help-concordance-results">Result panel</h2>

Preview pages, page sizes, and source-metadata sorts are fresh projections over
the retained snapshot. They never read the current mutable Data Block, so
editing a source cannot silently change that Preview Analysis.

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

Match markers and dispersion series use the colour assigned to their source
Data Block in the selector. Combined Results retain those colours so sources
remain distinguishable across the table and summary chart.

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
**Clear Selection** removes the filter. Selected bins affect the current
Preview display only.

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

<h3 id="help-concordance-run-all">Run All and Review</h3>

**Run All** can be started before or after Preview. It submits one thin Run All
group with one independent Supporting Analysis per selected source. Each child
uses the Run All request's immutable snapshot and tokenizer mapping and retains
one complete table Result. Run All does not add Data Blocks to the Workspace.

After success, **Review** reads each immutable Result through explicit match and
document projections. Table View always shows **Matches per page**. Dispersion
View can page by **Matches** or **Documents**; for two sources the selected page
size applies per source. Changing the paging unit returns to page 1. Review has
no page-local Found summary.

The Review density chart always summarizes the complete immutable Result, not
the visible page. `CONC_dispersion` remains a frontend presentation field and
is never stored or queried as a physical Result column.

Use **Add to Workspace** to create Derived Data Blocks after reviewing the
Result. The document column is required. Metadata columns start unselected,
analysis columns start selected, and you may change the output names before
submitting one atomic Result Publication.

<h3 id="help-concordance-clear-results">Clear results</h3>

The Tab keeps its complete Analysis forest. **Clear Results** removes that
forest, including after failure or cancellation.

<h2 id="help-concordance-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| No results on one page | The current source-document batch has no match | Continue to the next page |
| Tokens mode is unavailable | At least one selected Data Block has no tokenizer | Select a tokenizer model for every input |
| Too many partial matches | Whole Word is off in Text mode | Enable **Whole Word** |
| A regular expression fails | Invalid pattern syntax | Test the pattern on regexr.com |
| A generated header does not sort | `CONC_*` values are computed after source paging | Sort by a displayed source metadata column |
| Run All is disabled | Inputs are incomplete or another Run All is active | Complete the inputs or wait for the active Analysis |
| Preview differs from the edited Data Block | You reopened a historical Preview Analysis | Use **Update Preview** to capture the current Data Block state |

<h2 id="help-concordance-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Search mode | Text, or Tokens for a fresh fully-tokenized selection | An explicit Text choice is preserved |
| Left / Right context | 10 tokens each | Range 0–50 |
| Whole Word | Off | Text mode only |
| Regular expression | Off | Text mode only |
| Case Sensitive | Off | Text mode only |
| Documents per page | 20 | Controls source documents evaluated per Preview page |
| View | Table | Dispersion summarizes the current page |
| Bin No. | 20 | 4, 5, 10, 20, 25, 50, or 100 |
| Chart type | Line | Line, Bar, or Area |
| Combined source display | Aggregate | Split uses solid/dashed source lines |

## Practice exercise

1. Select a Data Block and Preview a Text-mode Whole Word search.
2. Compare two source-metadata sort orders.
3. Switch to Dispersion, change the bin count, and select a bin range.
4. Run All and inspect the joined Review table.
5. Change the source Data Block, reopen the historical Preview Analysis, and
   then use **Update Preview** to compare the new request deliberately.

[← Back to tutorial index](./index.md)
