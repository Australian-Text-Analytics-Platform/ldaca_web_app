<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-sequential-section">Sequential analysis tutorial</h1>

![Sequential analysis screenshot](tutorials/assets/sequential_analysis.png)

Sequential analysis explores how events or terms evolve over time. It is useful when your data has timestamps.

> **Placeholder (GIF):** Selecting a time column and previewing a sequence chart.

<h2 id="help-sequential-parameters">Parameter panel</h2>

Use the parameter panel to select the time column and the aggregation frequency.

<h3 id="help-sequential-time-column">Time column selector</h3>

Choose the column that contains your dates or timestamps. The analysis depends on this column to order events.

**Q: What format should the time column use?**

Use a standard date or datetime format. If parsing fails, clean the column before running the analysis.

<h3 id="help-sequential-frequency">Frequency selector</h3>

Pick how to group time into intervals (daily, weekly, monthly, etc.).

- Smaller intervals show more detail.
- Larger intervals smooth the trend.

<h2 id="help-sequential-results">Result panel</h2>

Use the result panel to inspect the sequence chart and supporting summaries.

<h3 id="help-sequential-clear-results">Clear results</h3>

Sequential analysis results are saved in the backend so the tab can reload and keep persistent pages. **Clear Results** removes the cached result in the backend and resets the analysis.

## Practice exercise

1. Select a date column.
2. Run the analysis with a weekly frequency.
3. Switch to monthly and compare patterns.

[← Back to tutorial index](./index.md)
