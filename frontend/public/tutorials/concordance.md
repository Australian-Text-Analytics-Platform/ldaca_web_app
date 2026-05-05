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

Click **Run** to start the concordance search. The button changes to **Update** once results exist; change the search term or settings and click **Update** to re-run.

<h2 id="help-concordance-results">Result panel</h2>

<h3 id="help-concordance-views">Table view and Dispersion view</h3>

Two view modes are available, switchable via the toggle in the results header:

**Table View**

![Table view screenshot](tutorials/assets/concordance/table_view.png)

Each row represents one match. If a document contains multiple matches, each appears as a separate row. Optionally, select metadata columns to display alongside the match using the column picker.

**Dispersion View**

![Dispersion view screenshot](tutorials/assets/concordance/dispersion_view.png)

Each row represents one document, and all matches within that document are plotted as vertical lines on a horizontal bar. The position of each line shows the relative location of the match within the document. Toggle **Proportional bar length** to scale bars by document character length, or keep all bars the same length for easier comparison.

<h3 id="help-concordance-display-mode">Separated and combined display</h3>

When two data blocks are selected, choose between **Separated** mode (each data block shown in its own section) and **Combined** mode (results interleaved, with the background colour of each row indicating its source data block).

<h3 id="help-concordance-detach">Add to Workspace</h3>

![Concordance detach screenshot](tutorials/assets/concordance/detach_datablocks.png)

The **Add to Workspace** button extracts the full search results as a new derived data block in the workspace. The detached block is automatically named *originalName*_conc and can be renamed later.

![Concordance detach metadata](tutorials/assets/concordance/detach_metadata.png)

At the start of the detach process, a dialog lets you choose which metadata columns from the parent data block to carry over. Consider your downstream analysis needs when making this selection — for example, include a date column if you plan to use the detached block in Trends and Sequence.

<h3 id="help-concordance-clear-results">Clear results</h3>

Concordance results are saved in the backend so the tab can reload and preserve your last results. **Clear Results** removes the cached result from the backend and resets the tab.

<h2 id="help-concordance-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| No results on a page | Search term absent in documents on this page | Navigate to the next page; the term may appear later in the corpus |
| Too many irrelevant partial matches | Whole Word not enabled | Enable **Whole Word** to avoid matching substrings |
| Regex returns an error | Invalid regex syntax | Test your pattern on [regexr.com](https://regexr.com/) first |
| Results differ unexpectedly between runs | Case Sensitive off; term appears in mixed case | Enable **Case Sensitive** to isolate exact capitalisation |
| Add to Workspace is disabled | No results loaded | Run the search first, then detach |

<h2 id="help-concordance-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Left / Right context | 10 tokens each | Range 0–50 |
| Whole Word | Off | Enable to avoid partial matches |
| Use Regular Expression | Off | — |
| Case Sensitive | Off | — |
| Documents per batch | 20 | Larger batches show more per page |

## Practice exercise

1. Select a data block and search for a common word in your text.
2. Enable **Whole Word** and compare the match count with it off.
3. Enable **Use Regular Expression** and search for two related words at once (e.g. `analyse|analyze`).
4. Increase the context window to 20 tokens and check whether more surrounding text changes your interpretation.
5. Click **Add to Workspace** to detach the results; include any date or speaker metadata columns.
6. Switch to Trends and Sequence, select the detached concordance data block, and plot the matches over time.

[← Back to tutorial index](./index.md)
