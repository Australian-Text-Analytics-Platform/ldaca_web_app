<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-sequential-section">Trends and Sequence tutorial</h1>

![Trends and Sequence screenshot](tutorials/assets/sequential_analysis.png)

The Trends and Sequence tool counts documents over time — or over any ordered numeric axis — and plots the result as a chart. It is useful for seeing how activity, mentions, or any measurable quantity rises and falls across a corpus.

You can break a single trend into multiple lines by grouping on one or more categorical columns, then zoom into and select specific periods for closer inspection.

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
| Per second | Each second |
| Per minute | Each minute |
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

Trends retains exact group values in its result. After the analysis finishes,
use **Uncased** beside the result legend when values that differ only in
capitalisation should be displayed and filtered as one group.

<h2 id="help-sequential-run">Step 5 — Run the analysis</h2>

Click **Run** to start the analysis. The label always remains **Run**. Parameters
lock only while the Analysis is submitting, queued, or running. After success,
change an execution input to enable Run again; reverting to the submitted values
disables it. Chart type, axis, selection, visibility, and Uncased controls do not
enable Run because they only change result presentation or filtering.

<h2 id="help-sequential-results">Result panel</h2>

![Trends and Sequence results](tutorials/assets/sequential_analysis/trends_results.png)

The result panel follows the Concordance dispersion layout: result actions in
the header, chart presentation controls directly above the plot, then the chart,
legend, and period-selection controls. Time column, frequency or interval, and
Group By settings remain visible in the parameter panel instead of being
repeated in the result.

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

Click the download button (↓ icon) in the results header to export the chart. A dialog lets you choose SVG, PNG, or JPEG. The exported file includes a header block with the data block name, time column, frequency, and document counts, plus a legend.

<h3 id="help-sequential-legend">Legend and group visibility</h3>

The legend below the chart lists all groups with their colours, full-result count, and share of the counts among currently visible groups. Percentages use one decimal place and do not change when periods are selected. When periods are selected, each visible label shows *selected / total* before the percentage. Click any legend item to hide or show that group. Hidden groups retain their count detail, show **Hidden**, and use a strikethrough label with reduced opacity.

Use this to focus on a subset of groups. Hidden groups are not plotted and are
marked hidden in chart exports, while their legend entry retains its
full-result count.

Select **Uncased** beside the legend to merge case variants without rerunning
the analysis. For example, `jobs` and `Jobs` become `jobs/Jobs`, with their
per-period values, totals, percentages, tooltip values, and export entry
summed. Changing this checkbox restores all hidden groups while preserving
selected periods, zoom, chart type, and axis mode.

<h3 id="help-sequential-zoom">Zoom and navigation</h3>

Use the chart slider, mouse wheel, or trackpad pinch to zoom along the horizontal axis. The toolbar also provides keyboard-accessible **Zoom in**, **Zoom out**, and **Reset zoom** buttons. Zoom changes only the viewport: it does not change the analysis result or clear selected periods.

<h3 id="help-sequential-period-selection">Period selection</h3>

Click anywhere inside the plot to select the time period nearest the vertical axis pointer. You do not need to target a line point, bar, or area segment. Selected periods are highlighted; unselected periods are dimmed to 25 % opacity.

To select a range, click one period then **Shift-click** another — all periods between them are selected.

For drag selection, turn on **Select range** and drag across the periods you want. A new drag replaces the current selection; **Shift-drag** adds the brushed range. Turn the mode off, or press **Escape** while the chart is focused, to return to point selection.

With keyboard focus on the chart, use **Left Arrow**, **Right Arrow**, **Home**, and **End** to inspect points. Press **Enter** or **Space** to select the focused point; hold **Shift** to extend the existing selection semantics.

Use **Clear Selection** to deselect all periods without losing any other settings.

<h3 id="help-sequential-add-to-workspace">Add to Workspace</h3>

Click **Add to Workspace** to create a Data Block containing original source
rows represented by the current Trends result. If periods are selected, only
those periods are included; with no selection, all periods are included. Hidden
legend groups are always excluded. Zoom changes only the viewport and never the
rows added to the Workspace.

When Uncased is enabled, hiding a merged legend entry excludes every exact
spelling represented by that entry.

The time or numeric axis column is required. The source Document Column and
Group By columns start selected but remain optional, while other source columns
start unselected. The dialog preserves source-column order and defaults the new
name to the source name followed by `_trends`.

<h3 id="help-sequential-clear-results">Clear results</h3>

The tab keeps its current Trends and Sequence Analysis in the backend so it can
reload its lifecycle and Result. **Clear Results** removes that Analysis and
resets the tab. After a failure or cancellation, parameters remain editable but
Run stays disabled until you choose Clear Results.

<h2 id="help-sequential-troubleshooting">Troubleshooting</h2>

| Symptom | Likely cause | What to try |
|---|---|---|
| Chart shows only one bar / point | Frequency too coarse for the date range | Try a finer frequency (e.g. daily instead of yearly) |
| Too many series, chart is unreadable | Too many distinct values in group-by column(s) | Remove a group-by column, or filter the data block first |
| "No sequential analysis data available" | Column type or interval is incompatible with the data | Check the column contains valid dates or numbers; check the interval is > 0 |

<h2 id="help-sequential-defaults">Quick-reference defaults</h2>

| Setting | Default | Notes |
|---|---|---|
| Frequency (datetime) | Monthly | Any standard or custom interval works |
| Custom interval | 1 day | Enter a positive number and choose a unit |
| Numeric Origin | Auto-detect | Leave blank unless you need a specific start |
| Numeric Interval | 1 | Required; must be > 0 |
| Group By | None | Up to 3 columns |
| Case Sensitive | Off | Only appears when a group-by column is added |
| Chart Type | Line Chart | — |
| X-axis | Categorical | Switch to Linear for time-proportional spacing |
| Zoom | Full range | Use Reset zoom to restore the complete result |
| Select range | Off | Turn on before dragging across periods |

## Practice exercise

1. Select a data block that has a datetime column.
2. Run the analysis with **Monthly** frequency to see the overall trend.
3. Switch to **Weekly** and compare the granularity.
4. Add a categorical column (e.g. author, genre, or platform) as a Group By column and choose **Run** again.
5. Zoom into a period of high activity, turn on **Select range**, and drag across several periods.
6. Download the chart in the format you need and compare it with the monthly view.

[← Back to tutorial index](./index.md)
