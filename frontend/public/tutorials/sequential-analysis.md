<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-sequential-section">Sequential analysis tutorial</h1>

![Sequential analysis screenshot](tutorials/assets/sequential_analysis.png)

Sequential analysis explores the quantity of specific groups evolve over time. It is useful when your data has either timestamps or a numeric column that represents certain type of ordering or ranking.

> **Placeholder (GIF):** Selecting a time column and previewing a sequence chart.

<h2 id="help-sequential-parameters">Parameter panel</h2>

Use the parameter panel to select the time column and the aggregation frequency.

<h3 id="help-sequential-time-column">Time column selector</h3>

Choose a column that contains the sequential data to be used for ordering the events, this can be datetime or numeric values (such as age, index etc.). 

**Q: What format should the time column use?**

Use a standard date or datetime format. If parsing fails, clean the column before running the analysis.

<h3 id="help-sequential-frequency">Frequency selector</h3>

Pick how to group the selected time or numeric values into intervals.

If a time column is selected, the user can choose the unit of time step as hourly, daily, weekly, monthly, quaterly, yearly or customise the base time unit for aggregating the data.

If a numeric column is selected, similarly the user can customise an interval as a whole numbers. 

- Smaller intervals show more details.
- Larger intervals smooth the trend.

**Q: What does the sequential analysis tool do?**
The sequential analysis tool performs a very simple task: Grouping the records(rows in data block) by the defined intervals and then plot the number of records in each step. For example, if the time of many social media posts is grouped in the hourly intervals, the plot simply represents how many posts were made in each hour, which is the trend of hourly activities during a certain period.

<h3 id="help-sequential-groups">Group by column conditions</h3>
In order to further break down the single line plot into more details, the user can add up to three columns for certain events. Each column must consist of a small number of values, which will be treated as a class/event in the visualisation. 

For example, in the previous social media example, if a *Platform* column is available to indicate which platform the post was made on. Using this *Platform* column as grouping condition will break down the activity trend line into multiple trends, each represents the number of posts created on a particular platform then the visualisation demostrates platform specific trendlines.

When multiple conditions are added, the classes are combined among columns, therefore the user needs to be aware of the large number of the new classes. For instance, if there were five platforms, the trendline is divided into five lines. If another column of post type with three values (post, reply and quote) is used together with platform, then the new combined classes becomes 5 x 3 = 15. Large number of classes often fragments the trend into meaningless adhoc patterns. 

<h2 id="help-sequential-results">Result panel</h2>

![Sequential analysis bar](tutorials/assets/sequential_analysis/sequential_results_bar.png)

Use the result panel to inspect the sequence chart and supporting summaries. Three plot modes can be chosen for visualising results: 
  - Line plot: Good to display the trend of a small number of continous events, e.g. historical population in different areas.
  - Bar chart: Good to highly the contrast among events in each step, e.g. gender difference in different periods.
  - Area plot: Stacks all events on top of each other, works the best when there are emerging or disappearing events. e.g. usage of emoji or slangs over time.

All classes are coloured randomly, click on the legend to hide/show the class in the visualisation. The user can hide dominant events from the results to zoom in to details of smaller events. 

<h3 id="help-sequential-clear-results">Clear results</h3>

Sequential analysis results are saved in the backend so the tab can reload and keep persistent pages. **Clear Results** removes the cached result in the backend and resets the analysis.

## Practice exercise

1. Select a date column.
2. Run the analysis with a weekly frequency.
3. Switch to monthly and compare patterns.

[← Back to tutorial index](./index.md)
