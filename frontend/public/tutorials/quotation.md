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

<h2 id="help-quotation-run">Step 4 — Run or re-run</h2>

Click **Run** to create a Quotation Analysis. If the Data Block, text column,
or engine changes afterward, click **Re-run** to replace the Tab's current
Analysis with a new immutable request.

The successful Analysis keeps its initial Result page and retained input
snapshot. Later page and sort requests use that snapshot, not the current
mutable Data Block. Navigating away does not expire a successful Result.

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

Changing the page, documents-per-batch value, or sort order creates another
projection of the same completed Analysis. It does not submit a new run.

<h3 id="help-quotation-detach">Add to Workspace</h3>

Click **Add to Workspace** to submit a direct Child Analysis that creates a
Derived Data Block from the completed Quotation Analysis. The child reads the
parent's immutable request and retained input snapshot, so later edits to the
source Data Block cannot alter its meaning.

Choose which optional source columns to copy. Generated quotation columns such
as `QUOTE_speaker`, `QUOTE_quote`, `QUOTE_verb`, their offsets, and quote type
are included by the operation. Select `QUOTE_extraction` when you also want the
raw source document under that canonical output name.

<h3 id="help-quotation-clear-results">Clear results</h3>

The Tab retains its Quotation Analysis and durable Result across navigation and
Workspace reopen. **Clear Results** removes the Analysis and resets the Tab,
including after failure or cancellation. **Re-run** clears the current Analysis
before submitting its replacement.

<h2 id="help-quotation-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| Remote engine is rejected | The ID is empty or not configured by the operator | Use **Built-in** or ask the deployment administrator for a valid ID |
| No quotations are shown on one page | The current source-document batch has no extracted quote | Continue to the next page |
| Precision is low | The text differs from the news style targeted by the rules | Review the disclaimer and validate a representative sample |
| A generated header does not sort | Generated quote fields are computed after source paging | Sort by the document header or source metadata |
| Results do not reflect a later Data Block edit | You are viewing the historical Analysis snapshot | Click **Re-run** to submit the changed source deliberately |

<h2 id="help-quotation-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Engine | Built-in | Remote requires an operator-configured engine ID |
| Context length | 5 words per side | Display-only, range 0–2000 |
| Result source | Immutable run snapshot | Page and sort changes do not re-run |

## Practice exercise

1. Select a news Data Block and run the built-in engine.
2. Inspect highlighted speaker, quote, and verb spans in several rows.
3. Change the display context length without re-running.
4. Sort by the virtual document header and a source metadata column.
5. Add selected output columns to the Workspace and inspect the Derived Data
   Block.

[← Back to tutorial index](./index.md)
