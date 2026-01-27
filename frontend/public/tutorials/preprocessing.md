<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1>Preprocessing tutorial</h1>

Preprocessing turns raw text data into analysis-ready datasets. Each sub-tab helps you shape data in a focused way, and every action creates a **new node** so you can compare results without overwriting the original.

Use this workflow in any tab:

1. Select one or more nodes from the workspace.
2. Configure the transformation.
3. Review the preview table.
4. Add the result back to the workspace.

<h2 id="help-preprocessing-common-section">Common controls</h2>

These controls appear in multiple preprocessing tabs and behave the same way across the workflow.

<h3 id="help-preprocessing-common-node-selection">Node selection panel</h3>

Select one or more nodes from the workspace graph. Each tab will show only the number of nodes it supports.

<h3 id="help-preprocessing-common-apply-button">Apply action</h3>

Use **Add to Workspace** or **Add to Node** to run the transformation. A new node is created (or the selected node is updated) without overwriting your source data.

<h3 id="help-preprocessing-common-preview">Preview table</h3>

The preview shows a paginated sample of what the output will look like. It is a quick way to confirm your configuration before applying it.

<h2 id="help-preprocessing-filter-section">Filter</h2>

Filter keeps only the rows that match your conditions. Use it to remove noise, focus on a subset, or create a clean working dataset before analysis.

<h3 id="help-preprocessing-filter-conditions">Filter conditions</h3>

Define one or more column-based rules, then choose AND/OR logic to combine them.

<h3 id="help-preprocessing-filter-new-node-name">New node name</h3>

Name the filtered output so it is easy to spot in the workspace.

Key controls include the node selection panel, the filter conditions builder (with AND/OR logic), the new node name input, the status summary, the **Add to Workspace** action, and the preview table that shows matched rows.

Practice exercise:

1. Select a dataset with a clear category column.
2. Add a condition that keeps only one category.
3. Add the filtered result as a new node.

<h2 id="help-preprocessing-slice-section">Slice</h2>

Slice extracts a contiguous range of rows. It is useful for sampling, debugging, or grabbing a fixed subset of text data.

<h3 id="help-preprocessing-slice-offset">Offset</h3>

The zero-based index of the first row to include.

<h3 id="help-preprocessing-slice-length">Length</h3>

The number of rows to include. Leave it blank to slice until the end.

<h3 id="help-preprocessing-slice-new-node-name">New node name</h3>

Label the slice output so it is easy to find later.

Key controls include the node selection panel, offset and length inputs, the new node name field, the range summary, the **Add to Workspace** action, and the preview table for the slice output.

Practice exercise:

1. Pick a dataset with at least 200 rows.
2. Set offset to 50 and length to 25.
3. Add the slice as a new node and compare the row count.

<h2>Join</h2>

Join combines two datasets using matching columns. Use it when your text data lives in one node and metadata lives in another, or when you need to enrich a dataset before analysis.

<h3 id="help-preprocessing-join-section">Join sub-tab overview</h3>

The Join sub-tab guides you through selecting up to two datasets, choosing join columns, and producing a combined node.

<h3 id="help-preprocessing-join-column-picker">Join column picker</h3>

Column pickers choose which column to match in each dataset.

- Pick columns that represent the same identifier in both nodes.
- Clean, consistent IDs produce the best joins.

<h3 id="help-preprocessing-join-type">Join type selector</h3>

Join type controls how unmatched rows are handled:

- **Inner:** only matching rows from both nodes.
- **Left:** all rows from the left node plus matches from the right.
- **Right:** all rows from the right node plus matches from the left.
- **Full:** all rows from both nodes; unmatched values become nulls.
- **Semi:** rows from the left node that have at least one match.
- **Anti:** rows from the left node with no matches.
- **Cross:** Cartesian product of both nodes (can be very large).

<h3 id="help-preprocessing-join-node-name">Join output name</h3>

Give the new joined dataset a clear name so it is easy to find later. Leave it blank to use the suggested name.

<h3 id="help-preprocessing-join-apply">Apply join</h3>

Use **Add to Workspace** to run the join and create a new node. Review the preview table before applying to confirm the output shape.

Practice exercise:

1. Select two datasets that share an ID column.
2. Choose that ID in both column pickers.
3. Run an inner join and compare row counts.

<h2 id="help-preprocessing-concat-section">Concat</h2>

Concat stacks multiple datasets vertically. Use it when you want to combine similar tables into one larger dataset.

<h3 id="help-preprocessing-concat-new-node-name">New node name</h3>

Provide a label for the stacked output. Leave it blank to use the suggested name.

<h3 id="help-preprocessing-concat-schema-status">Schema status</h3>

The schema status summary tells you whether all selected nodes share the same column structure and highlights mismatches.

Key controls include multi-selecting nodes in the workspace, reviewing schema status and mismatch details, choosing an optional output name, applying **Add to Workspace**, and checking the preview table.

Practice exercise:

1. Select two datasets with the same columns.
2. Leave the new node name blank.
3. Add the concatenated result and confirm the column list matches.

<h2 id="help-preprocessing-aggregate-section">Aggregate</h2>

Aggregate builds computed columns on top of a selected node. Use it to create derived fields before analysis.

<h3 id="help-preprocessing-aggregate-builder">Expression builder</h3>

Drag column tokens and custom text to build a Polars-style expression without typing.

<h3 id="help-preprocessing-aggregate-expression">Advanced expression</h3>

Write the expression directly when you need full control, helper functions, or complex logic.

<h3 id="help-preprocessing-aggregate-column-name">New column name</h3>

Set a clear label for the computed column so it is easy to use downstream.

Key controls include the node selection panel, the Basic builder, the Advanced editor, the optional new column name, the **Add to Node** action, and the preview showing the computed column.

Practice exercise:

1. Select a dataset with at least two numeric columns.
2. In the Basic tab, drag two columns into the builder.
3. Add the computed column and confirm it appears in the preview.

[← Back to tutorial index](./index.md)
