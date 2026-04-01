<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-sequential-section">Sequential analysis tutorial</h1>

![Sequential analysis screenshot](tutorials/assets/sequential_analysis.png)

Sequential analysis explores how the quantity of specific groups changes over time. It is useful when your data contains timestamps or a numeric column that represents some form of ordering or ranking.

> **Placeholder (GIF):** Selecting a time column and previewing a sequence chart.

<h2 id="help-sequential-parameters">Parameter panel</h2>

Use the parameter panel to select the time column and the aggregation frequency.

<h3 id="help-sequential-time-column">Time column selector</h3>

Choose a column that contains the sequential data used to order events. This can be datetime or numeric values (such as age, index, etc.).

**Q: What format should the time column use?**

Use a standard date or datetime format. If parsing fails, clean the column before running the analysis.

<h3 id="help-sequential-frequency">Frequency selector</h3>

Choose how to group the selected time or numeric values into intervals.

If a time column is selected, you can choose the time step unit: hourly, daily, weekly, monthly, quarterly, or yearly. You can also define a custom base time unit for aggregation.

If a numeric column is selected, you can define a custom interval as a whole number.

- Smaller intervals show more detail.
- Larger intervals smooth the trend.

**Q: What does the sequential analysis tool do?**

The sequential analysis tool groups records (rows in the data block) by the defined intervals and plots the number of records in each step. For example, if the timestamps of social media posts are grouped into hourly intervals, the plot shows how many posts were made in each hour — revealing the trend of hourly activity over a given period.

<h3 id="help-sequential-groups">Group by column conditions</h3>

To break down the single trend line into more detail, you can add up to three columns as grouping conditions. Each column should contain a small number of distinct values; these will be treated as categories in the visualisation.

For example, using the social media example above: if a *Platform* column is available to indicate which platform each post was made on, adding *Platform* as a grouping condition will split the activity trend into separate lines — one for each platform.

When multiple grouping conditions are added, the categories are combined across columns. Be aware that this can produce a large number of combined categories. For instance, if there are five platforms and a post type column with three values (post, reply, and quote), the combined categories become 5 × 3 = 15. A large number of categories often fragments the trend into meaningless, irregular patterns.

<h2 id="help-sequential-results">Result panel</h2>

![Sequential analysis bar](tutorials/assets/sequential_analysis/sequential_results_bar.png)

Use the result panel to inspect the sequence chart and supporting summaries. Three plot modes are available:

- **Line plot:** Best for displaying trends across a small number of continuous events — e.g. historical population in different regions.
- **Bar chart:** Best for highlighting contrast between categories at each step — e.g. gender differences across time periods.
- **Area plot:** Stacks all categories on top of each other; works best when categories emerge or disappear over time — e.g. the use of emoji or slang over the years.

All categories are assigned random colours. Click a legend item to show or hide that category. You can hide dominant categories to focus on smaller ones.

<h3 id="help-sequential-clear-results">Clear results</h3>

Sequential analysis results are saved in the backend, so the tab can reload and retain previous results. **Clear Results** removes the cached result from the backend and resets the analysis.

## Practice exercise

1. Select a date column.
2. Run the analysis with a weekly frequency.
3. Switch to monthly and compare the patterns.

[← Back to tutorial index](./index.md)
