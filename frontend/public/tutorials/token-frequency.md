<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-token-frequency-section">Token Frequency tutorial</h1>

![Token frequency screenshot](tutorials/assets/token_frequency.png)

Token Frequency counts how often each word appears in your text data. It is one of the quickest ways to spot themes and jargon in a corpus. The tool offers two main views: a word cloud for a quick visual impression and a ranked frequency list for precise counts. When two data blocks are selected, a statistical keyword analysis compares word usage between them and highlights the terms that are most distinctive to each side.

<h2 id="help-token-frequency-parameters">Parameter panel</h2>

<h3 id="help-token-frequency-data-block">Step 1 — Select your data</h3>

Use the data-block selector to choose which corpus (or corpora) to analyse. You can select up to two data blocks at once. When two are selected, the tool runs in comparison mode and produces a unified word cloud and statistical measures in addition to the per-block results.

For each selected block, choose the **text column** that contains the documents you want to count. Only columns that hold plain text are available.

<h3 id="help-token-frequency-stop-words">Step 2 — Stop words</h3>

![Stop words screenshot](tutorials/assets/token_frequency/stop_words.png)

Stop words are terms you want to exclude from the frequency count — commonly words like *the*, *and*, or domain-specific filler that would otherwise dominate the results.

- Type words separated by spaces into the stop words field. Matching is case-insensitive.
- Click **Fill Defaults** to populate the field with a built-in list of common English stop words.
- Click **Sort** to sort the current stop-word list alphabetically.
- Click **Apply** to apply the current stop-word list to the results. Removing stop words does not change the statistical measures of remaining tokens — they are excluded as a post-processing step.
- Right-click any word in the word cloud or frequency table to add it to the stop-word list directly.

<h3 id="help-token-frequency-token-limit">Step 3 — Token limit</h3>

The **Token Limit** controls how many of the top tokens are displayed in the word cloud and frequency table. The range is 1–100; the default is 50. Increase it to see more of the long tail, or lower it to keep the view focused on the most prominent terms.

<h2 id="help-token-frequency-run">Step 4 — Run the analysis</h2>

Click **Analyze** to run. The button changes to **Update** once results exist, letting you adjust stop words or the token limit and re-run without clearing first.

If you want to run the analysis on a different data block, click **Clear Results** first to reset the tool before selecting the new block.

<h2 id="help-token-frequency-results">Result panel</h2>

The result panel shows a word cloud and a ranked frequency table for each selected data block. When two data blocks are selected, a unified word cloud and a statistical measures table are also shown.

<h3 id="help-token-frequency-word-cloud">Word cloud</h3>

The word cloud visualises the most frequent terms for each data block. Word size corresponds to frequency. Left-click any word to jump to the Concordance tab and search for that term in context. Right-click any word to add it to the stop-word list.

Download options are available for each cloud: PNG, SVG, or PDF. You can also download the associated stop-word list alongside the image as a zip file.

<h3 id="help-token-frequency-unified-word-cloud">Unified word cloud</h3>

![Unified word cloud screenshot](tutorials/assets/token_frequency/unified_word_cloud.png)

When two data blocks are selected, the unified word cloud highlights the words that are most distinctively used by each block, using the keyword analysis method (log-ratio comparison).

- **Size** reflects combined frequency across both blocks.
- **Colour** shifts toward the block where the word has the higher proportional share, so differences in corpus size do not dominate the palette.
- Words are ranked by log₁₀(O₁ + O₂) × LogRatio, and the view shows the highest and lowest N words by that score (up to twice the token limit).

<h3 id="help-token-frequency-statistical-measures">Statistical measures</h3>

![Statistical measures screenshot](tutorials/assets/token_frequency/statistical_measures.png)

The statistical table summarises token-level differences between the two data blocks. Click any column header to sort ascending or descending.

| Column | What it shows |
|---|---|
| O1 / O2 | Observed frequency in each data block |
| %1 / %2 | Percentage of total tokens in each data block |
| LL | Log-likelihood G² statistic — higher means a more significant difference |
| %DIFF | Percentage-point difference between the two data blocks |
| Bayes | Bayes factor (BIC) |
| ELL | Effect size for log-likelihood |
| RRisk | Relative risk ratio |
| LogRatio | Log of relative frequencies |
| OddsRatio | Odds ratio between data blocks |
| Significance | \*\*\*\* p < 0.0001, \*\*\* p < 0.001, \*\* p < 0.01, \* p < 0.05 |

Use the **Head / Tail Rows (N)** control to show the first and last N rows of the sorted table. Sorting always applies to the full dataset before trimming.

The full table can be downloaded as a CSV file. For further reading on keyword analysis methodology, see the [Lancaster corpus linguistics resource](https://www.lancaster.ac.uk/fss/courses/ling/corpus/blue/l03_2.htm).

<h3 id="help-token-frequency-clear-results">Clear results</h3>

Token Frequency results are saved in the backend so the tab can reload and retain your last run. **Clear Results** removes the cached result and resets the tab. You must clear first before switching to a different data block.

<h2 id="help-token-frequency-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| Results unchanged after removing stop words | Stop words not applied | Click **Apply** after editing the stop-word list |
| Word cloud dominated by common words | No stop words applied | Click **Fill Defaults** then **Apply** |
| Unified word cloud or statistics are missing | Only one data block selected | Select a second data block to enable comparison mode |
| Statistical table shows no significant words | Corpora are very similar or one is very small | Try a larger or more distinct pair of data blocks |
| Analyze button is disabled | No data block selected, or no text column chosen | Select a data block and pick a text column |

<h2 id="help-token-frequency-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Data blocks | None | Up to 2; comparison mode activates when 2 are selected |
| Stop words | Empty | Click **Fill Defaults** for a built-in English list |
| Token limit | 50 | Range 1–100 |

## Practice exercise

1. Select a data block and click **Analyze** with the default settings.
2. Click **Fill Defaults** to apply the built-in stop-word list, then click **Apply** and compare the top tokens before and after.
3. Right-click one of the remaining high-frequency words in the word cloud to add it as a custom stop word.
4. Select a second data block and re-run to see the unified word cloud and statistical measures.
5. Sort the statistical table by **LogRatio** to find the words most distinctively associated with each data block.
6. Left-click one of the top distinctive words to jump to Concordance and inspect it in context.

[← Back to tutorial index](./index.md)
