<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-sequential-section">Trends and Sequence tutorial</h1>

![Trends and Sequence screenshot](tutorials/assets/sequential_analysis.png)

The Trends and Sequence tool counts documents over time — or over any ordered numeric axis — and plots the result as a chart. It is useful for seeing how activity, mentions, or any measurable quantity rises and falls across a corpus.

You can break a single trend into multiple lines by grouping on one or more categorical columns, and you can select specific time periods to extract as a new data block for further analysis.

<h2 id="help-sequential-parameters">Parameter panel</h2>

<h3 id="help-sequential-data-block">Step 1 — Select your data</h3>

Use the data-block selector to pick the corpus you want to analyse. Only one data block can be selected at a time.

<h3 id="help-sequential-time-column">Step 2 — Choose a time or numeric column</h3>

The **Time/Numeric Column** dropdown lists every column in the selected data block that holds a datetime, integer, or float value. Pick the column that represents the order or time axis you want to plot along.

- **Datetime columns** are bucketed by a calendar frequency (hourly, daily, weekly, etc.).
- **Numeric columns** (integer or float) are bucketed by a fixed interval width you specify.

The tool detects the column type automatically and shows the relevant configuration controls below.

<h3 id="help-sequential-frequency">Step 3 — Set the frequency (datetime columns)</h3>

When a datetime column is selected, choose how to group records into time buckets.

**Standard frequencies**

| Option | Groups records by |
|---|---|
| Hourly | Each hour of the day |
| Daily | Each calendar day |
| Weekly | Each week (Mon–Sun) |
| Monthly | Each calendar month |
| Quarterly | Each quarter (Q1–Q4) |
| Yearly | Each calendar year |

**Customised interval**

Select **Customised** to bucket by a fixed duration you define: enter a positive whole number and choose a unit (seconds, minutes, hours, days, or weeks). For example, *Every 30 minutes* groups records into half-hour windows.

- Smaller intervals show more detail but may produce many sparse buckets.
- Larger intervals smooth the trend and reduce noise.

<h3 id="help-sequential-numeric">Step 3 — Set the numeric interval (numeric columns)</h3>

When an integer or float column is selected, two fields appear:

**Numeric Origin** — the starting point of the first bucket. Leave blank to auto-detect from the minimum value in the data.

**Numeric Interval** — the width of each bucket (required). For example, an interval of 10 groups values 0–9, 10–19, 20–29, and so on.

<h3 id="help-sequential-group-by">Step 4 — Group By Columns (optional)</h3>

To split the trend into multiple lines — one per category — add up to three columns as grouping conditions. Each added column should have a small number of distinct values; these become the separate series in the chart.

Click **Add Group** to add a column selector row. A badge next to each selector shows the number of unique values in that column, which helps you judge how many series will be produced.

When multiple grouping columns are added, categories are combined across all columns. Be aware this multiplies the number of series: three platforms × four genres = twelve combined series. Too many series can make the chart unreadable.

**Case sensitive** — a checkbox that appears once at least one group column is added. When checked, values that differ only in capitalisation are treated as separate groups. When unchecked, they are merged.

<h2 id="help-sequential-run">Step 5 — Run the analysis</h2>

Click **Run** to start the analysis. The button label changes to **Update** when you change parameters after a successful run, letting you re-run without clearing first.

<h2 id="help-sequential-results">Result panel</h2>

![Trends and Sequence results](tutorials/assets/sequential_analysis/trends_results.png)

The result panel shows a summary row, a chart, a legend, and the period-selection controls for extracting data.

<h3 id="help-sequential-stats">Summary stats</h3>

Six tiles at the top of the result panel summarise the current view. The **Total**, **Shown**, and **Chosen** tiles display two numbers separated by a slash — for example *42 / 1,250* — where the first number is the count of time-period buckets and the second is the total document count across those buckets.

| Tile | What it shows |
|---|---|
| Time Column | The column used as the time axis |
| Frequency / Numeric Interval | The bucketing unit in effect — e.g. *Monthly* or *Interval: 10* |
| Total | All buckets / all documents in the result, before any filtering |
| Shown | Buckets / documents remaining after the Min Group Size filter is applied |
| Chosen | Buckets / documents in your current period selection; shows *0 / 0* until you click a period |
| Groups | The group-by columns in effect, listed by name, or *None* |

For example, a **Shown** value of *18 / 934* means 18 time buckets are currently visible, together containing 934 documents. The **Chosen** tile updates live as you click periods in the chart, and its document count is what drives the **Add to Workspace** button.

<h3 id="help-sequential-min-group-size">Min Group Size filter</h3>

The **Min Group Size** input in the results header hides any group (series) whose total document count is below the value you enter. This is useful when a few groups have very few records and clutter the chart.

- Default is 10. Set to 0 to show all groups regardless of size.
- The filter applies immediately — no need to re-run.
- The **Shown** tile updates to reflect how many points and documents remain after filtering.

<h3 id="help-sequential-chart-type">Chart type</h3>

Three plot modes are available in the **Chart Type** dropdown:

- **Line Chart** — best for displaying continuous trends across time, especially when groups overlap or you want to compare rates of change.
- **Bar Chart** — best for highlighting contrast between categories at each time step.
- **Area Chart** — stacks all groups on top of each other. Works best when groups emerge or disappear over time and you want to see total volume alongside composition.

<h3 id="help-sequential-x-axis">X-axis: Categorical vs Linear</h3>

The **X-axis** dropdown next to the chart type selector switches the horizontal axis between two modes:

- **Categorical** *(default)* — every time bucket gets an equal slot on the axis, regardless of the real gap between them. Best when buckets are dense and you want a clean, evenly-spaced view.
- **Linear** — the axis is a true number/date line and bucket positions are proportional to their values. Gaps in the data become visible as visible gaps on the axis. Useful for spotting unevenly-spaced events or comparing rates of change across long time spans.

In Linear mode with a datetime column, axis ticks render as date labels (e.g. *Apr 2018*) rather than raw epoch numbers. The tool aims for about ten ticks across the visible range, dropping labels automatically if the chart is too narrow.

**Missing buckets are shown as zero.** When a group has no documents in a given bucket, the line stays connected and dips to zero rather than breaking. This matches the analytical intent — "no occurrences" is genuinely zero, not unknown — and is most visible in Linear mode where the gap distance is proportional to time.

<h3 id="help-sequential-download">Download chart</h3>

Click the download button (↓ icon) in the results header to export the chart. A dialog lets you choose the format: PNG, SVG, or PDF. The exported file includes a header block with the data block name, time column, frequency, and document counts, plus a legend.

<h3 id="help-sequential-legend">Legend and group visibility</h3>

The legend below the chart lists all groups with their colours. Click any legend item to hide or show that group. Hidden groups are shown with a strikethrough label and reduced opacity.

Use this to focus on a subset of groups without changing the Min Group Size filter. Hidden groups are excluded from chart exports but are still counted in the **Total** tile.

<h3 id="help-sequential-period-selection">Period selection</h3>

Click any bar, line point, or area segment in the chart to select that time period. Selected periods are highlighted; unselected periods are dimmed to 25 % opacity.

To select a range, click one period then **Shift-click** another — all periods between them are selected.

The **Chosen** tile tracks how many points and documents are in the current selection. The **Add to Workspace** button shows the selection count.

Use **Clear Selection** to deselect all periods without losing any other settings.

<h3 id="help-sequential-detach">Add to Workspace</h3>

Once you have selected the periods of interest, use the **Add to Workspace** control below the chart to extract those documents into a new data block:

1. Type a name in the **New data block name** field, or press <kbd>Tab</kbd> to accept the auto-generated placeholder (e.g. *MyCorpus_trend*).
2. Click **Add to Workspace (N)** — where N is the number of selected time periods.

The new data block will contain all documents from the selected periods that belong to the visible groups (groups hidden via the legend are excluded). The button is disabled if no periods are selected, if all periods are selected, or if no visible groups remain after the Min Group Size filter.

<h3 id="help-sequential-clear-results">Clear results</h3>

Trends and Sequence results are saved in the backend so the tab can reload and retain previous results. **Clear Results** removes the cached result from the backend and resets the analysis.

<h2 id="help-sequential-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| Chart shows only one bar / point | Frequency too coarse for the date range | Try a finer frequency (e.g. daily instead of yearly) |
| All groups filtered out | Min Group Size is too high | Lower Min Group Size or set it to 0 |
| Too many series, chart is unreadable | Too many distinct values in group-by column(s) | Remove a group-by column, or filter the data block first |
| "No sequential analysis data available" | Column type or interval is incompatible with the data | Check the column contains valid dates or numbers; check the interval is > 0 |
| Add to Workspace is disabled | No periods selected, or all periods selected, or no visible groups | Select a subset of periods; adjust Min Group Size so at least one group is visible |

<h2 id="help-sequential-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Frequency (datetime) | Monthly | Any standard or custom interval works |
| Custom interval | 1 day | Enter a positive number and choose a unit |
| Numeric Origin | Auto-detect | Leave blank unless you need a specific start |
| Numeric Interval | 1 | Required; must be > 0 |
| Group By | None | Up to 3 columns |
| Case Sensitive | Off | Only appears when a group-by column is added |
| Min Group Size | 10 | Set to 0 to show all groups |
| Chart Type | Line Chart | — |
| X-axis | Categorical | Switch to Linear for time-proportional spacing |

## Practice exercise

1. Select a data block that has a datetime column.
2. Run the analysis with **Monthly** frequency to see the overall trend.
3. Switch to **Weekly** and compare the granularity.
4. Add a categorical column (e.g. author, genre, or platform) as a Group By column and re-run.
5. Click a period of high activity to select it, then Shift-click a later period to extend the selection.
6. Click **Add to Workspace** to extract those documents into a new data block for further analysis.

[← Back to tutorial index](./index.md)
