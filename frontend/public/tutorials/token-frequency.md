<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-token-frequency-section">Token Frequency tutorial</h1>

![Token frequency screenshot](tutorials/assets/token_frequency.png)

Token Frequency counts how often each word appears in your text data. It is one of the quickest ways to spot themes and jargon in a corpus. The tool offers two views: **Cloud view** for a visual impression of the most frequent terms, and **List view** for a ranked frequency list with precise counts. When two data blocks are selected, the tool also produces a comparative keyword analysis — the **Juxtorpus** cloud — and a statistical measures table that highlight the terms most distinctive to each side.

<h2 id="help-token-frequency-parameters">Parameter panel</h2>

<h3 id="help-token-frequency-data-block">Step 1 — Select your data</h3>

Use the data-block selector to choose which corpus (or corpora) to analyse. The tool is strictly pairwise — at most two data blocks at a time — because keyword analysis is defined between exactly one reference and one study corpus. If more than two blocks are selected at the workspace level, the tool only shows the **two most recent** picks; any older selections are silently dropped from the panel until you deselect a newer block to make room.

When two are selected, the tool runs in comparison mode and produces the Juxtorpus cloud and statistical measures in addition to the per-block results.

For each selected block, choose the **text column** that contains the documents you want to count. Only columns that hold plain text are available.

<h3 id="help-token-frequency-reference">Step 2 — Reference Data Block (comparison mode)</h3>

When two data blocks are selected, a **Reference Data Block** toggle appears below the data-block selectors. Click the coloured circle next to a block to designate it as the reference (Corpus 1).

The reference block provides the baseline for the statistical keyword analysis: its frequencies appear as **O1** and **%1** in the statistics table, and the other block appears as **O2** and **%2**. Swapping the reference flips which side each statistic measures from, which can change the sign of directional measures like LogRatio.

<h3 id="help-token-frequency-stop-words">Step 3 — Stop words</h3>

![Stop words screenshot](tutorials/assets/token_frequency/stop_words.png)

Stop words are terms you want to exclude from the frequency count — commonly words like *the*, *and*, or domain-specific filler that would otherwise dominate the results.

- Type words separated by spaces into the stop words field. Matching is case-insensitive.
- Click **Fill Default** to populate the field with a built-in list of common English stop words.
- Click **Sort** to sort the current stop-word list alphabetically.
- Click **Apply Stop Words** to apply the current list to the results. Removing stop words does not change the statistical measures of remaining tokens — they are excluded as a post-processing step.
- Right-click any word in the word cloud or frequency list to add it directly to the stop-word list. Words added this way are **inserted at the start of the list** so they are easy to find and remove. The list is not re-sorted until you click **Sort**.

<h2 id="help-token-frequency-run">Step 4 — Run the analysis</h2>

Click **Analyze** to run. The button changes to **Update** once results exist, letting you adjust settings and re-run without clearing first.

If you want to run the analysis on a different data block, click **Clear Results** first to reset the tool.

<h2 id="help-token-frequency-results">Result panel</h2>

The results panel shows controls for stop words and display limits at the top, followed by a **Cloud view / List view** tab to switch between the two output modes.

<h3 id="help-token-frequency-token-limit">Cloud display limit</h3>

The **Cloud display limit** (range 10–100, default 50) sets the maximum number of tokens shown in the word clouds. Changing this value also updates the List display limit to the same number (capped at 100).

<h3 id="help-token-frequency-list-limit">List display limit</h3>

The **List display limit** (range 10 – vocabulary size) sets the maximum number of tokens shown in the ranked frequency lists. Values up to 100 stay in sync with the Cloud display limit; setting the list limit above 100 lets you see a longer tail in list view while the cloud remains capped at 100.

<h2 id="help-token-frequency-cloud-view">Cloud view</h2>

![Cloud view screenshot](tutorials/assets/token_frequency/cloud_view.png)

Cloud view shows a word cloud for each selected data block, followed by the Juxtorpus cloud when two blocks are selected.

Word size in each per-block cloud corresponds to frequency. Interaction:

- **Left-click** any word to jump to the Concordance tab and search for that term in context.
- **Right-click** any word to add it to the stop-word list (it is inserted at the start of the list).

A download button is available for each cloud (PNG, SVG, or PDF). You can optionally include the associated stop-word list in the download as a zip file.

<h3 id="help-token-frequency-unified-word-cloud">Juxtorpus</h3>

When two data blocks are selected, the Juxtorpus cloud appears below the per-block clouds. It highlights the words that are most distinctively used by each block, using the keyword analysis method (log-ratio comparison).

- **Size** reflects combined frequency across both blocks.
- **Colour** shifts toward the block where the word has the higher proportional share, so differences in corpus size do not dominate the palette.
- Words are ranked by log₁₀(O₁ + O₂) × LogRatio; the cloud shows the highest and lowest N words by that score (up to twice the cloud display limit).

<h2 id="help-token-frequency-list-view">List view</h2>

![List view screenshot](tutorials/assets/token_frequency/list_view.png)

List view shows a ranked horizontal bar chart for each selected data block, with the statistics table below when two blocks are compared.

**Word ranking**

Tokens are listed in descending order of frequency. The bar length for each token is proportional to its count relative to the most frequent token in that block. When two data blocks are shown side by side, the blocks are scrolled **synchronously** — scrolling one list scrolls the other to the same position, making it easy to compare the same rank across both corpora.

<h3 id="help-token-frequency-token-filter">Filter tokens</h3>

A **Filter tokens** input appears at the bottom of the results when List view is active. Type a pattern to narrow both frequency lists and the statistics table simultaneously. Use `*` as a wildcard:

- `pre*` — all tokens starting with *pre*
- `*ing` — all tokens ending in *ing*
- `*ation*` — all tokens containing *ation*

Click **Clear** to remove the filter. The word clouds are not affected by the token filter.

<h3 id="help-token-frequency-statistical-measures">Keyword Analysis</h3>

![Keyword Analysis table screenshot](tutorials/assets/token_frequency/statistical_measures.png)

The **Keyword Analysis** table summarises token-level differences between the two data blocks. A caption directly under the section heading shows *Reference corpus: {name}; Study corpus: {name}* with each name coloured to match the chart palette colour you picked for that block — so it's always clear at a glance which side of the comparison is which. Click any column header to sort ascending or descending.

| Column | What it shows |
|---|---|
| O1 / O2 | Observed frequency in each data block (O1 = reference block) |
| %1 / %2 | Percentage of total tokens in each data block |
| LL | Log-likelihood G² statistic — higher means a more significant difference |
| %DIFF | Percentage-point difference between the two data blocks |
| Bayes | Bayes factor (BIC) |
| ELL | Effect size for log-likelihood |
| RRisk | Relative risk ratio |
| LogRatio | Log of relative frequencies — positive values skew toward the reference block |
| OddsRatio | Odds ratio between data blocks |
| Significance | \*\*\*\* p < 0.0001, \*\*\* p < 0.001, \*\* p < 0.01, \* p < 0.05 |

Use the **Head / Tail Rows (N)** control to show the first and last N rows of the sorted table. Sorting always applies to the full dataset before trimming.

The full table can be downloaded as a CSV file. For further reading on keyword analysis methodology, see the [Lancaster corpus linguistics resource](https://www.lancaster.ac.uk/fss/courses/ling/corpus/blue/l03_2.htm).

<h3 id="help-token-frequency-clear-results">Clear results</h3>

Token Frequency results are saved in the backend so the tab can reload and retain your last run. **Clear Results** removes the cached result and resets the tab. You must clear first before switching to a different data block.

<h2 id="help-token-frequency-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| Results unchanged after removing stop words | Stop words not applied | Click **Apply Stop Words** after editing the list |
| Word cloud dominated by common words | No stop words applied | Click **Fill Default** then **Apply Stop Words** |
| Juxtorpus or Keyword Analysis table are missing | Only one data block selected | Select a second data block to enable comparison mode |
| Keyword Analysis table shows no significant words | Corpora are very similar or one is very small | Try a larger or more distinct pair of data blocks |
| A workspace block I selected isn't showing in the panel | Token Frequency caps the panel to the 2 most-recent selections | Deselect a newer block to make room, or run the comparison on the visible pair |
| Right-clicked stop word is hard to find | List was already long when the word was added | New words are inserted at the top — scroll to the start, or click **Sort** to alphabetise |
| Analyze button is disabled | No data block selected, or no text column chosen | Select a data block and pick a text column |

<h2 id="help-token-frequency-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Data blocks | None | Up to 2; comparison mode activates when 2 are selected. If more than 2 are selected workspace-wide, only the 2 most recent show in the panel. |
| Reference Data Block | First selected block | Changes O1/O2 assignment in the statistics table |
| Stop words | Empty | Click **Fill Default** for a built-in English list |
| Cloud display limit | 50 | Range 10–100; mirrors to list limit |
| List display limit | 50 | Range 10 – vocabulary size; values > 100 diverge from cloud |

## Practice exercise

1. Select a data block and click **Analyze** with the default settings.
2. Click **Fill Default** to apply the built-in stop-word list, then **Apply Stop Words** and compare the top tokens.
3. Right-click one of the remaining high-frequency words in the cloud to add it as a custom stop word. Confirm it appears at the start of the stop-word list.
4. Select a second data block. Use the **Reference Data Block** toggle to set which block is the baseline, then re-run.
5. Switch to **List view** and use **Filter tokens** with a wildcard pattern (e.g. `*ing`) to find all gerund-form tokens.
6. In **List view**, scroll one frequency list and observe that the other list scrolls in sync.
7. Sort the statistics table by **LogRatio** to find the words most distinctively associated with each data block.
8. Left-click one of the top distinctive words to jump to Concordance and inspect it in context.

[← Back to tutorial index](./index.md)
