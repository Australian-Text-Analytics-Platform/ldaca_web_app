<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-token-frequency-section">Token frequency tutorial</h1>

![Token frequency screenshot](tutorials/assets/token_frequency.png)

Token frequency counts how often words or tokens appear in your text data. It is one of the quickest ways to spot themes and jargon.

> **Placeholder (GIF):** Run token frequency and scroll through the top tokens.

<h2 id="help-token-frequency-parameters">Parameter panel</h2>

Use the parameter panel to choose which data blocks and text columns to analyze. Stop-word filtering and token display limits are adjusted after the run in the results panel.

<h3 id="help-token-frequency-stop-words">Stop words input</h3>

![Stop words screenshot](tutorials/assets/token_frequency_stop_words.png)

Stop words are words you want to ignore (like “the”, “and”, or domain-specific filler). Add them here to clean your results.

Use **Fill Default** to load the app's bundled English stop-word list from packaged resource files. You can edit that list freely before or after applying it.

**Q: Why remove stop words?**

High-frequency filler terms can hide the meaningful terms you want to study.

<h3 id="help-token-frequency-run">Run token frequency</h3>

This action runs the token frequency analysis on the selected data block or comparison pair.

- Results appear in a table and can be downloaded.
- After the run completes, you can adjust stop words and token display limits in the results panel without rerunning the analysis.

<h2 id="help-token-frequency-results">Result panel</h2>

Use the result panel to inspect token lists, compare two data blocks, and review the statistical summary. Click any token to jump to concordance.

<h3 id="help-token-frequency-unified-word-cloud">Unified word cloud</h3>

![Unified word cloud screenshot](tutorials/assets/token_frequency_unified_word_cloud.png)

The unified word cloud blends the two selected data blocks into one comparison view.

- **Selection:** tokens are ranked by $\log_{10}(O_1 + O_2) \times \text{LogRatio}$ and the view includes the lowest and highest scores (up to twice the token limit).
- **Size:** token size reflects $O_1 + O_2$ (combined frequency across both datasets).
- **Color:** color shifts toward the side where the token has a higher percentage share, so different dataset sizes do not dominate the palette.

<h3 id="help-token-frequency-statistical-measures">Statistical measures</h3>

![Statistical measures screenshot](tutorials/assets/token_frequency_statistical_measures.png)

The statistical table summarizes token differences between the two datasets.

- **Head/Tail Rows (N):** shows the first $N$ and last $N$ rows of the sorted table; sorting always applies to the full set before trimming.
- **Key definitions:**
  - **O1/O2:** observed frequencies in each dataset.
  - **%1/%2:** percentage of total tokens in each dataset.
  - **LL:** log-likelihood $G^2$ statistic (higher = more significant difference).
  - **%DIFF:** percentage point difference between datasets.
  - **Bayes:** Bayes factor (BIC).
  - **ELL:** effect size for log likelihood.
  - **RRisk:** relative risk ratio.
  - **LogRatio:** log of relative frequencies.
  - **OddsRatio:** odds ratio between datasets.
  - **Significance:** \***_ $p < 0.0001$, _** $p < 0.001$, \*_ $p < 0.01$, _ $p < 0.05$.

<h3 id="help-token-frequency-clear-results">Clear results</h3>

Token frequency results are saved in the backend so this tab can reload and keep persistent pages of your last run. **Clear Results** removes that cached result from the backend and resets the tab.

## Practice exercise

1. Run token frequency with default settings.
2. Add 3 extra stop words that look like noise.
3. Apply them and compare the top 10 tokens.

[← Back to tutorial index](./index.md)
