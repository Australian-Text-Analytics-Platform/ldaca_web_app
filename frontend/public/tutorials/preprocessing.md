<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1>Data Preprocessing tutorial</h1>

![Preprocessing screenshot](tutorials/assets/preprocessing.png)

The Data Preprocessing tools transform and prepare raw text data blocks into analysis-ready datasets. Each sub-tab helps you shape data in a certain way, and every action creates a **new data block** so the original data blocks are not overwritten and all operations are recoverable. There are currently six tool tabs in this section:
1. Filter - Create a subset of the selected data block based on one or a series of data-driven logic operations;
2. Sample - Create a subset of the selected data block by either sampling a certain fraction/number of rows randomly, or slice a chunk of data from the data block.
3. Join - Create a new data block by linking two selected data blocks on certain columns with common values.
4. Stack - Create a new data block by connecting/stacking two selected data blocks, which share identical column headers.
5. Find - Use regular expression (RegEx) to match certain text pattern from the selected text column, then either remove, replace or extract the matched texts to the selected, or a different, column in the data block.
6. Create - Combine the contents from two or more columns and save the outcomes as a new column in the data block.

In order to process relevant data block(s) in any tab, the user needs to:

1. Select one or more data blocks from the workspace - depending on the need.
2. Configure the transformation to be done with the selected tool.
3. Review the preview table and make sure it shows expected outcomes.
4. Add the result back to the workspace as a new child data block of the original selected data block(s).

<h2 id="help-preprocessing-common-section">Common controls</h2>

These controls appear in multiple preprocessing tabs and behave the same way across the workflow.

<h3 id="help-preprocessing-common-node-selection">Data block selection panel</h3>

Select one or more data blocks from the workspace graph or the data block list. Each tool will only work when designated number of data blocks are selected.

<h3 id="help-preprocessing-common-apply-button">Apply action</h3>

Use **Add to Workspace** or **Add to Data Block** to run the transformation. A new data block is created (or the selected data block is updated) without overwriting your source data block.

<h3 id="help-preprocessing-common-preview">Preview table</h3>

The preview pane displays the outcomes in a paginated format with an estimated size. The user can quickly check the results of different configurations before applying the pre-processing and producing a new data block to the workspace.

<h2 id="help-preprocessing-filter-section">Filter</h2>

![Filter screenshot](tutorials/assets/preprocessing/filter.png)

The filter tool keeps only the rows that match defined conditions. Use it to remove noise, focus on a subset, or create a clean working dataset before analysis. This tool accepts only one selected data block at a time.

<h3 id="help-preprocessing-filter-conditions">Filter conditions</h3>

![Filter conditions screenshot](tutorials/assets/preprocessing/filter_conditions.png)

Define one or more column-based logic conditions, where each condition can be defined differently based on the data type of selected column. All conditional outcomes can be combined by either AND or OR logic operation for the final filtered outcomes.
1. Use the "Add Condition" button to add more conditions to be applied.
2. Select the desired combining logic operation for all conditions. The webApp does not support chain of various logic operations.
3. All individual conditions can be negated by checking the "negate" checkbox.
4. The preview pane displays the number of rows to be filtered based on the current condition set. It is possible to return an empty data block if there isn't any eligible row from the selected data block, or the conditions are conflicting.

<h3 id="help-preprocessing-filter-new-node-name">New data block name</h3>

![Filter new data block name screenshot](tutorials/assets/preprocessing/filter_new_node_name.png)

The user can name the filtered output data block so it is easy to spot in the workspace. The new data block is a child data block of the original selected data block.

Key controls include the data block selection panel, the filter conditions builder (with AND/OR logic), the new data block name input, the status summary, the **Add to Workspace** action, and the preview table that shows matched rows.

Practice exercise:

1. Select a dataset with a clear category column.
2. Add a condition that keeps only one category.
3. Add the filtered result as a new data block.

<h2 id="help-preprocessing-slice-section">Sample Tool</h2>

![Sample screenshot](tutorials/assets/preprocessing/sample.png)

Sample tool extracts either a contiguous range or a randomised set of rows from the selected data block. Extracting a small and representive subset of the data makes exploring and debugging quicker than working with the full size data.

<h3 id="help-preprocessing-slice-offset">Slice</h3>

![Slice screenshot](tutorials/assets/preprocessing/slice.png)

The slice option extract a continous chunk of data from the data block. The offset parameters set the start row of the chunk (first row as 0). 

<h3 id="help-preprocessing-slice-length">Length</h3>

The number of rows to include in the extraction. Leave it blank to slice until the end of the data block. If you want the sub-block to include the row 101-200, set offset = 100 and length = 100.

<h3 id="help-preprocessing-sample-fraction">Fraction/Count</h3>

![Sample screenshot](tutorials/assets/preprocessing/sample.png)

The sample option extract a set of randomised rows from the data block. You can define to sample either a proportion (e.g. 30%) or a certain number of rows (e.g. 500) from the selected data block. 

For proportional sampling, enter a decimal number between 0 and 1 for this parameter. For example, 0.3 to extract 30% of the selected data block. Or a whole number for number of rows, e.g. 100 to extract 100 rows. If the whole number is greater than the size of the data block, all rows will be extracted in a shuffled order.

<h3 id="help-preprocessing-sample-seed">Random Seed</h3>

The random seed controls the reproducibility of the random sampling process. Setting a fixed seed ensures the same rows/order are extracted each time from the **same data**.

- Use any non-negative integer (e.g. 0, 42, 12345).
- Remember the seed value when you want consistent, reproducible results.

<h3 id="help-preprocessing-slice-new-node-name">New data block name</h3>

Label the slice output so it is easy to find later. The pre-populated name include the parameters of the selected operation.

Key controls include the data block selection panel, offset and length inputs, the new data block name field, the range summary, the **Add to Workspace** action, and the preview table for the slice output.

Practice exercise:

1. Pick a dataset with at least 200 rows.
2. Set offset to 50 and length to 25.
3. Add the slice as a new data block and compare the row count.

<h2>Join</h2>

![Join screenshot](tutorials/assets/preprocessing/join.png)

Join combines two data blocks using matching columns. Use it when your text data lives in one data block and metadata lives in another, or when you need to enrich a data block before analysis.

<h3 id="help-preprocessing-join-section">Join sub-tab overview</h3>

The Join sub-tab guides you through selecting two data blocks, choosing the columns from each data block that consist of common values, then "stitch" both data blocks side-by-side together based on the joining columns.

Depending on the type of the joining method and common values between two data blocks, the outcome data block can be longer or shorter than the selected source data blocks, but it will include all columns from both data blocks hence wider than the source data blocks.

<h3 id="help-preprocessing-join-column-picker">Join column picker</h3>

![Join column picker screenshot](tutorials/assets/preprocessing/join_column_picker.png)

Column pickers choose which column to match in each data block.

- Pick columns that represent the same identifier in both data blocks.
- Clean, consistent IDs produce the best joins.
- The webApp will *guess* and pre-populate the columns that are more likely to share common values from both data blocks, but the user is responsible to select the correct joining columns and type of joining method.

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

![Stack screenshot](tutorials/assets/preprocessing/concat.png)

The Stack tab combines multiple data blocks vertically. Use it when you want to merge multiple data blocks with identical headers into one longer data block.

<h3 id="help-preprocessing-concat-new-node-name">New data block name</h3>

Provide a label for the stacked output. Leave it blank to use the suggested name.

<h3 id="help-preprocessing-concat-schema-status">Schema status</h3>

![Schema status screenshot](tutorials/assets/preprocessing/concat_schema_status.png)

The schema status summary tells you whether all selected data blocks share the same column structure and highlights mismatches.

Key controls include multi-selecting data blocks in the workspace, reviewing schema status and mismatch details, choosing an optional output name, applying **Add to Workspace**, and checking the preview table.

Practice exercise:

1. Select two datasets with the same columns.
2. Leave the new data block name blank.
3. Add the stacked result and confirm the column list matches.

<h2 id="help-preprocessing-aggregate-section">Create</h2>

![Create screenshot](tutorials/assets/preprocessing/create.png)

The create tab allows user to builds new columns in a selected data block by merging contents from multiple columns as texts. This is useful when different columns are to be analysed as a whole, e.g. combining title, abstract and body text as the full article content.

<h3 id="help-preprocessing-aggregate-builder">Expression builder</h3>

Drag column tokens and custom text to build a Polars-style expression without typing.

How it works:

- Drag column bubbles into the builder to add them to the equation.
- Add the Custom Text bubble for operators or literals, then click it to edit.
- The builder concatenates tokens with `+` automatically, quoting custom text.
- Reorder any bubble by dragging it before or after an existing one.

<h3 id="help-preprocessing-aggregate-expression">Advanced expression</h3>

![Advanced expression screenshot](tutorials/assets/preprocessing/create_expression.png)

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
