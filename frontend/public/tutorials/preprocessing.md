<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1>Data Preprocessing tutorial</h1>

![Preprocessing screenshot](tutorials/assets/preprocessing.png)

Data Preprocessing turns raw text data into analysis-ready datasets. Each sub-tab helps you shape data in a focused way, and every action creates a **new data block** so you can compare results without overwriting the original.

Use this workflow in any tab:

1. Select one or more data blocks from the workspace.
2. Configure the transformation.
3. Review the preview table.
4. Add the result back to the workspace.

<h2 id="help-preprocessing-common-section">Common controls</h2>

These controls appear in multiple preprocessing tabs and behave the same way across the workflow.

<h3 id="help-preprocessing-common-node-selection">Data block selection panel</h3>

Select one or more data blocks from the workspace graph. Each tab will show only the number of data blocks it supports.

<h3 id="help-preprocessing-common-apply-button">Apply action</h3>

Use **Add to Workspace** or **Add to Data Block** to run the transformation. A new data block is created (or the selected data block is updated) without overwriting your source data.

<h3 id="help-preprocessing-common-preview">Preview table</h3>

The preview shows a paginated sample of what the output will look like. It is a quick way to confirm your configuration before applying it.

<h2 id="help-preprocessing-filter-section">Filter</h2>

![Filter screenshot](tutorials/assets/preprocessing_filter.png)

Filter keeps only the rows that match your conditions. Use it to remove noise, focus on a subset, or create a clean working dataset before analysis.

<h3 id="help-preprocessing-filter-conditions">Filter conditions</h3>

![Filter conditions screenshot](tutorials/assets/preprocessing_filter_conditions.png)

Define one or more column-based rules, then choose AND/OR logic to combine them.

<h3 id="help-preprocessing-filter-new-node-name">New data block name</h3>

![Filter new data block name screenshot](tutorials/assets/preprocessing_filter_new_node_name.png)

Name the filtered output so it is easy to spot in the workspace.

Key controls include the data block selection panel, the filter conditions builder (with AND/OR logic), the new data block name input, the status summary, the **Add to Workspace** action, and the preview table that shows matched rows.

Practice exercise:

1. Select a dataset with a clear category column.
2. Add a condition that keeps only one category.
3. Add the filtered result as a new data block.

<h2 id="help-preprocessing-slice-section">Sample</h2>

![Slice screenshot](tutorials/assets/preprocessing_slice.png)

Sample lets you either extract a contiguous range of rows with <strong>Slice</strong> or draw a <strong>Random Sample</strong> using a fraction (0–1) or absolute row count (≥ 1) and an optional seed. It is useful for debugging, quick inspection, and creating repeatable subsets of larger text data.

Use the sampling method dropdown at the top of the card to switch between Slice and Random Sample.

<h3 id="help-preprocessing-slice-offset">Offset</h3>

When Slice is selected, Offset is the zero-based index of the first row to include.

<h3 id="help-preprocessing-slice-length">Length</h3>

When Slice is selected, Length is the number of rows to include.

<h3 id="help-preprocessing-slice-new-node-name">New data block name</h3>

Label the sampled output so it is easy to find later.

Key controls include the data block selection panel, the sampling method dropdown, mode-specific parameter inputs, the new data block name field, the status summary, the **Add to Workspace** action, and the preview table for the output rows.

Practice exercise:

1. Pick a dataset with at least 200 rows.
2. Try Slice with offset 50 and length 25, then try Random Sample with fraction 0.2, or count 100, and a fixed seed.
3. Add each result as a new data block and compare the row count.

<h2>Join</h2>

![Join screenshot](tutorials/assets/preprocessing_join.png)

Join combines two data blocks using matching columns. Use it when your text data lives in one data block and metadata lives in another, or when you need to enrich a data block before analysis.

<h3 id="help-preprocessing-join-section">Join sub-tab overview</h3>

The Join sub-tab guides you through selecting up to two data blocks, choosing join columns, and producing a combined data block.

<h3 id="help-preprocessing-join-column-picker">Join column picker</h3>

![Join column picker screenshot](tutorials/assets/preprocessing_join_column_picker.png)

Column pickers choose which column to match in each data block.

- Pick columns that represent the same identifier in both data blocks.
- Clean, consistent IDs produce the best joins.

<h3 id="help-preprocessing-join-type">Join type selector</h3>

Join type controls how unmatched rows are handled:

- **Inner:** only matching rows from both data blocks.
- **Left:** all rows from the left data block plus matches from the right.
- **Right:** all rows from the right data block plus matches from the left.
- **Full:** all rows from both data blocks; unmatched values become nulls.
- **Semi:** rows from the left data block that have at least one match.
- **Anti:** rows from the left data block with no matches.
- **Cross:** Cartesian product of both data blocks (can be very large).

<h3 id="help-preprocessing-join-node-name">Join output name</h3>

Give the new joined data block a clear name so it is easy to find later. Leave it blank to use the suggested name.

<h3 id="help-preprocessing-join-apply">Apply join</h3>

Use **Add to Workspace** to run the join and create a new data block. Review the preview table before applying to confirm the output shape.

Practice exercise:

1. Select two datasets that share an ID column.
2. Choose that ID in both column pickers.
3. Run an inner join and compare row counts.

<h2 id="help-preprocessing-concat-section">Stack</h2>

![Stack screenshot](tutorials/assets/preprocessing_concat.png)

Stack combines multiple data blocks vertically. Use it when you want to merge similar tables into one larger data block.

<h3 id="help-preprocessing-concat-new-node-name">New data block name</h3>

Provide a label for the stacked output. Leave it blank to use the suggested name.

<h3 id="help-preprocessing-concat-schema-status">Schema status</h3>

![Schema status screenshot](tutorials/assets/preprocessing_concat_schema_status.png)

The schema status summary tells you whether all selected data blocks share the same column structure and highlights mismatches.

Key controls include multi-selecting data blocks in the workspace, reviewing schema status and mismatch details, choosing an optional output name, applying **Add to Workspace**, and checking the preview table.

Practice exercise:

1. Select two datasets with the same columns.
2. Leave the new data block name blank.
3. Add the stacked result and confirm the column list matches.

<h2 id="help-preprocessing-aggregate-section">Create</h2>

![Create screenshot](tutorials/assets/preprocessing_create.png)

Create builds computed columns on top of a selected data block. Use it to create derived fields before analysis.

<h3 id="help-preprocessing-aggregate-builder">Expression builder</h3>

Drag column tokens and custom text to build a Polars-style expression without typing.

How it works:

- Drag column bubbles into the builder to add them to the equation.
- Add the Custom Text bubble for operators or literals, then click it to edit.
- The builder concatenates tokens with `+` automatically, quoting custom text.
- Reorder any bubble by dragging it before or after an existing one.

<h3 id="help-preprocessing-aggregate-expression">Advanced expression</h3>

![Advanced expression screenshot](tutorials/assets/preprocessing_create_expression.png)

Write the expression directly when you need full control, helper functions, or complex logic.

Expression tips:

- Use column names directly (`A`) or wrap spaced names in quotes (`"Total Count"`).
- Combine with helpers like `abs()`, `round(value, 2)`, `when(condition, then, otherwise)`, `coalesce(a, b)`.
- Call `lit("value")` to force a literal string when it matches an existing column name.

<h3 id="help-preprocessing-aggregate-column-name">New column name</h3>

Set a clear label for the computed column so it is easy to use downstream.

Key controls include the data block selection panel, the Basic builder, the Advanced editor, the optional new column name, the **Add to Data Block** action, and the preview showing the computed column.

Practice exercise:

1. Select a dataset with at least two numeric columns.
2. In the Basic tab, drag two columns into the builder.
3. Add the computed column and confirm it appears in the preview.

[← Back to tutorial index](./index.md)
