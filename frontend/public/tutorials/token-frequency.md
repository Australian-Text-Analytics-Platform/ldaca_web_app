<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-token-frequency-section">Token frequency tutorial</h1>

![Token frequency screenshot](tutorials/assets/token_frequency.png)

Token frequency counts how often words or tokens appear in your text data. It is one of the quickest ways to spot themes and jargon. This webApp provide two most common approaches for frequency analysis, which are wordcloud and word frequency list. On top of the straight forward word counts per data block, the token frequency tool allows user to compare two data blocks using [Keyword Analysis method](https://www.lancaster.ac.uk/fss/courses/ling/corpus/blue/l03_2.htm) and visualises the most significant words in a combined word cloud.

The following sections explain basic operations in this token frequency tool.

> **Placeholder (GIF):** Run token frequency and scroll through the top tokens.

<h2 id="help-token-frequency-parameters">Parameter panel</h2>

Use the parameter panel to choose which data blocks and text columns to be analysed. 
The Stop-words and number of words to be displayed can be adjusted after the run in the results panel. 

<h3 id="help-token-frequency-stop-words">Stop words input</h3>

![Stop words screenshot](tutorials/assets/token_frequency/stop_words.png)

The stopwords are words the user choose to ignore (like “the”, “and”, or domain-specific filler) from the result. User can input a list of words (separated by space, case insentive), fill the default set of stopwords by **Fill Default** clicking the button [source](), or add specific words by right clicking the unwanted words in the wordcloud or frequency list visual. 

**Q: Why remove stopwords?**
High-frequency filler terms can hide the meaningful terms you want to study.

**Q: Will applying stopwords affect the results of other words?**
No, the removal of stopwords does not affect the statistical measures of other words as these are removed as a post-process.

<h3 id="help-token-frequency-run">Run token frequency</h3>

This action runs the token frequency analysis on the selected data block or comparison pair.
If the user choose a different (set of) data block(s)), the tool needs to be reset by clicking the Clear Results button.


<h2 id="help-token-frequency-results">Result panel</h2>

Use the result panel to inspect token lists, compare two data blocks, and review the statistical summary if two data blocks are selected.

- The most significant N words (by word count or statistics) are visualised.
- Full results can be downloaded as a tabular format file. 
- When downloading the word cloud image or frequency table file, the associated stopwords can be downloaded together in a zip file.
- Right click any token in the visualisation to add the token to the stopwords list.
- Left click any token in the visualisation to jump to the concordance tool for co-occurance analysis.

<h3 id="help-token-frequency-unified-word-cloud">Unified word cloud</h3>

![Unified word cloud screenshot](tutorials/assets/token_frequency/unified_word_cloud.png)

When two data blocks are selected for frequency analyis, the unified word cloud visualises the most significantly biased words by comparing the word usages with the Keyword Analysis method.

- **Selection:** tokens are ranked by $\log_{10}(O_1 + O_2) \times \text{LogRatio}$ and the view includes the lowest N and highest N scores (up to twice the token limit).
- **Size:** token size reflects $O_1 + O_2$ (combined frequency across both data blocks).
- **Color:** color shifts toward the side where the token has a higher percentage share, so different dataset sizes do not dominate the palette.

<h3 id="help-token-frequency-statistical-measures">Statistical measures</h3>

![Statistical measures screenshot](tutorials/assets/token_frequency/statistical_measures.png)

- The statistical table summarizes token differences between the two datasets.
- Click on the column header to sort the table in ascending or descending order.
For more details, please refer to the following [webpage](https://www.lancaster.ac.uk/fss/courses/ling/corpus/blue/l03_2.htm)

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

Token frequency results are saved in the backend so this tab can reload and keep persistent pages of your last run. **Clear Results** removes that cached result from the backend and resets the tab. This reset is needed if the user want to run the analysis on a (set of) different data block(s).

## Practice exercise

1. Run token frequency with default settings.
2. Add 3 extra stop words that look like noise.
3. Apply them and compare the top 10 tokens.

[← Back to tutorial index](./index.md)
