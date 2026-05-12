<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-quotation-section">Quotation Extraction tutorial</h1>

![Quotation extraction screenshot](tutorials/assets/quotation_extraction.png)

Quotation Extraction is a specialised tool for identifying quoted speech, the speaker, and related linguistic information from news articles. It is built on code from the [Gender Gap Tracker](https://github.com/sfu-discourse-lab/GenderGapTracker) project developed by the Discourse Processing Lab at Simon Fraser University, Canada.

**Disclaimer**: The tool is a rule-based algorithm developed for Canadian media research. Its keywords, spelling conventions, and grammar rules may not perform as well on other text types (e.g. social media, novels) or different English varieties (e.g. dialects, UK spelling, historical newspapers). No algorithmic approach can guarantee 100 % precision — always review results at scale to understand the limitations and performance on your specific collection before drawing conclusions.

<h2 id="help-quotation-parameters">Parameter panel</h2>

<h3 id="help-quotation-data-block">Step 1 — Select your data</h3>

Use the data-block selector to choose the data block to analyse. Quotation Extraction processes one data block at a time. For each selected block, pick the **text column** that contains the news article text.

<h3 id="help-quotation-engine">Step 2 — Configure the engine</h3>

![Quotation engine setting](tutorials/assets/quotation_tool/engine_setting.png)

The core quotation extraction model is hosted as a separate service rather than bundled directly into the app. Click the **gear icon** when hovering over the Quotation tab to open the engine configuration dialog.

![Quotation engine configure](tutorials/assets/quotation_tool/engine_remote.png)

Two engine modes are available:

- **Local Engine** — connects to a quotation service running on your own machine. Use this if you have deployed the Docker container locally for faster processing.
- **Remote Engine** — sends documents to the LDaCA-hosted service at `http://legacy-tools.ldaca.edu.au:8801/api/v1/quotation/extract` (default). This service has size and rate limits; avoid sending large batches simultaneously and expect slower processing for large collections.

Contact [sih.info@sydney.edu.au](mailto:sih.info@sydney.edu.au) if you need to set up a local deployment.

<h3 id="help-quotation-context-length">Step 3 — Context length</h3>

The **Context Length** (words per side) controls how many words are extracted as surrounding context before and after each found quotation entity. The extracted quotation components themselves (speaker, quote, and verb) are always included as separate columns; this setting adds extra surrounding text to help you evaluate the extractions in context.

- Default: 5 words per side. Range: 0–2000.
- Increase the context if the surrounding text is important for interpreting the results.
- Set to 0 if you only need the extracted components themselves.

<h2 id="help-quotation-run">Step 4 — Run the extraction</h2>

Click **Run** to start the extraction. The button changes to **Update** once results exist. Processing time depends on corpus size and whether you are using the remote or local engine.

<h2 id="help-quotation-results">Result panel</h2>

The result panel displays a paginated table of extracted quotation entities. Each row represents one extracted entity from a source document.

<h3 id="help-quotation-highlights">Result highlights</h3>

Each result row shows the source text with colour-coded highlights for the three extracted entity types:

| Colour | Entity | What it identifies |
|---|---|---|
| Blue | Speaker | The person attributed as saying the quote |
| Green | Quote | The quoted text itself |
| Violet | Verb | The speech verb (e.g. *said*, *stated*, *argued*) |

The optional metadata columns from the source data block can be shown or hidden using the column picker in the results header. The pagination footer shows **Documents searched / N matches found**, where matches are the total extracted quotation rows across documents searched on that page.

<h3 id="help-quotation-detach">Add to Workspace</h3>

![Quotation detach](tutorials/assets/quotation_tool/detach_options.png)

Click **Add to Workspace** to extract the results as a new derived data block. A dialog lets you choose which optional columns from the parent data block to carry over — pick the metadata you need for downstream analysis (e.g. date, source, author).

The picker also lists **`QUOTE_extraction`** as an opt-in column. When ticked, every detached row carries the raw source document text under this canonical name, regardless of what the source column was originally called. Useful when you want to share or re-analyse the detached block alongside the original text without depending on a project-specific column name.

Mandatory generated columns (`QUOTE_speaker`, `QUOTE_quote`, `QUOTE_verb`, and the various index / type columns) are always included and don't appear in the picker.

The detached data block can then be analysed with other tools. For example, use Trends and Sequence to plot quoted speech over time, or Concordance to inspect how specific speakers or speech verbs are used.

<h3 id="help-quotation-clear-results">Clear results</h3>

Quotation results are saved in the backend so the tab can reload and keep persistent pages. **Clear Results** clears the cached result in the backend and resets the tab.

<h2 id="help-quotation-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| No results returned | Engine unreachable or wrong endpoint | Check engine configuration; verify the service is running |
| Very low precision (many wrong extractions) | Text type not suited to the rule-based model | Review the disclaimer above; the tool is optimised for news articles |
| Processing is very slow | Remote engine rate limit or large batch | Reduce the corpus size, or set up a local Docker deployment |
| Results disappear after navigating away | Normal — cached results expire | Re-run or use **Add to Workspace** to persist results as a data block |

<h2 id="help-quotation-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Engine | Remote | Configure via gear icon on the tab |
| Remote endpoint | `http://legacy-tools.ldaca.edu.au:8801/api/v1/quotation/extract` | Changeable in the engine dialog |
| Context length | 5 words per side | Range 0–2000 |

## Practice exercise

1. Select a data block of news articles and run Quotation Extraction with the default context length.
2. Browse the results and identify a row where the speaker colour highlight looks incorrect — check what rule-based error caused it.
3. Increase the context length to 20 and re-run to see more surrounding text for ambiguous cases.
4. Click **Add to Workspace** to detach the results; include a date column if one is available.
5. Switch to Trends and Sequence, select the detached block, and plot quoted speech frequency over time.

[← Back to tutorial index](./index.md)
