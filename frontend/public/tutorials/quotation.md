<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-quotation-section">Quotation Extraction tutorial</h1>

Quotation Extraction identifies quoted speech, speakers, and speech verbs in
English news-style text. The built-in rule-based engine is based on the
[Gender Gap Tracker](https://github.com/sfu-discourse-lab/GenderGapTracker)
work from Simon Fraser University's Discourse Processing Lab.

The rules were developed for Canadian news. Results may be less accurate for
social media, fiction, historical documents, or other English varieties.
Review a representative sample before drawing conclusions from the output.

<h2 id="help-quotation-parameters">Parameter panel</h2>

<h3 id="help-quotation-data-block">Step 1 — Select your data</h3>

Add one Data Block and choose the source text column. A fresh selector uses the
Data Block's saved Document Column Preference when available. The Analysis
records the exact Data Block and column used for the run.

<h3 id="help-quotation-engine">Step 2 — Choose the engine</h3>

The engine is an Analysis parameter in the Quotation panel:

- **Built-in** is the default and runs the bundled local quotation engine. It
  needs no separate service, URL, or user configuration.
- **Remote** sends the work to an endpoint configured by the deployment
  operator. Enter the operator-provided **Engine id**. Wordflow does not accept
  arbitrary service URLs from the browser, and an unknown ID is rejected.

Use Remote only when the administrator of your Wordflow deployment has given
you a valid engine ID and its data-handling policy is appropriate for the text.
The immutable Analysis request stores `Built-in` or the selected remote engine
ID, never a host URL.

<h3 id="help-quotation-context-length">Step 3 — Set display context</h3>

**Context length (words per side)** controls how much source text the Result
table displays around the highlighted quotation spans. It is a presentation
setting, not an extraction-engine parameter.

- Default: 5 words per side.
- Range: 0–2000.
- Use 0 to keep the display close to the extracted speaker, quote, and verb.

<h2 id="help-quotation-run">Step 4 — Preview</h2>

Click **Preview** to create a durable Quotation Preview Analysis. The label
always remains **Preview**. If the Data Block, text column, or engine changes,
Preview becomes available again; reverting exactly to the submitted request
disables it. Preview and **Run All** keep independent request baselines.

The successful Preview Analysis keeps its retained input snapshot. Each page and
sort request recomputes a fresh projection from that snapshot, not the current
mutable Data Block. Preview pages are not cached.

<h2 id="help-quotation-results">Result panel</h2>

The table pages through source documents and omits documents with no extracted
quotation. A source document can contribute several quotation rows.

| Colour | Entity | Meaning |
|---|---|---|
| Blue | Speaker | The person attributed as speaking |
| Green | Quote | The quoted text |
| Violet | Verb | The speech verb, such as *said* or *argued* |

Click a row to inspect the full source document. The metadata selector can add
source fields and generated quotation fields to the table. The virtual
`QUOTE_extraction` document header sorts by the Analysis's selected source text
column. Other source metadata headers remain sortable; generated quotation
headers are display-only because they are produced after source paging.

Changing the page, documents-per-batch value, or sort order recomputes another
projection of the same Preview Analysis. It does not mutate that Analysis.

<h3 id="help-quotation-run-all">Run All and Review</h3>

Click **Run All** at any time to submit an independent Run All Analysis that
retains a complete table Result from its own immutable snapshot. Later source
edits do not alter that Analysis's meaning, and Run All does not add a Data
Block to the Workspace. After success, **Review** reads the immutable Result.
**Page by Documents** shows the highlighted reading view, while **Page by
Matches** shows one raw extract per row with scalar `QUOTE_*` fields. Changing
the paging unit returns to page 1. Review does not show the Preview page
summary.

Use **Add to Workspace** to publish selected Result columns as a Derived Data
Block. The document column is required, metadata columns start unselected, and
analysis columns start selected.

<h3 id="help-quotation-clear-results">Clear results</h3>

The Tab retains its Analysis forest across navigation and Workspace reopen.
**Clear Results** removes the complete forest. Preview or Run All locks every
parameter only while submission or execution is active; Stop becomes available
once the task exists. If either root fails or is cancelled, parameters unlock
but both execution actions stay disabled until Clear Results.

<h2 id="help-quotation-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| Remote engine is rejected | The ID is empty or not configured by the operator | Use **Built-in** or ask the deployment administrator for a valid ID |
| No quotations are shown on one page | The current source-document batch has no extracted quote | Continue to the next page |
| Precision is low | The text differs from the news style targeted by the rules | Review the disclaimer and validate a representative sample |
| A generated header does not sort | Generated quote fields are computed after source paging | Sort by the document header or source metadata |
| Preview does not reflect a later Data Block edit | You are viewing the historical Preview snapshot | Change an execution input and choose **Preview** to capture a new snapshot |

<h2 id="help-quotation-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Engine | Built-in | Remote requires an operator-configured engine ID |
| Context length | 5 words per side | Display-only, range 0–2000 |
| Preview source | Immutable Preview snapshot | Every page and sort request is recomputed |

## Practice exercise

1. Select a news Data Block and Preview with the built-in engine.
2. Inspect highlighted speaker, quote, and verb spans in several rows.
3. Change the display context length.
4. Sort by the virtual document header and a source metadata column.
5. Run All, inspect Review, and use **Add to Workspace** if you need a Derived
   Data Block.

[← Back to tutorial index](./index.md)
