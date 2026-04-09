<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1>Data Preprocessing tutorial</h1>

![Preprocessing screenshot](tutorials/assets/preprocessing.png)

The Data Preprocessing tools transform and prepare raw text data blocks into analysis-ready datasets. Each tab lets you transform data in a specific way, and every action creates a **new data block** so the original data blocks are not overwritten and all operations are recoverable. There are currently six tool tabs in this section:
1. Filter - Create a subset of the selected data block based on one or more filter conditions.
2. Sample - Create a subset of the selected data block by either randomly sampling a certain fraction or number of rows, or by slicing a contiguous chunk of rows from the data block.
3. Join - Create a new data block by linking two selected data blocks on columns with common values.
4. Stack - Create a new data block by vertically stacking two selected data blocks that share identical column headers.
5. Find - Use Regular Expressions (RegEx) to match text patterns in the selected text column, then remove, replace, or extract the matched text into the same column or a new column in the data block.
6. Create - Combine the contents of two or more columns and save the result as a new column in the data block.

In order to process relevant data block(s) in any tab, the user needs to:

1. Select one or more data blocks from the workspace - depending on the need.
2. Configure the transformation to be done with the selected tool.
3. Review the preview table and make sure it shows expected outcomes.
4. Add the result back to the workspace as a new child data block of the original selected data block(s).

<h2 id="help-preprocessing-common-section">Common controls</h2>

These controls appear in multiple preprocessing tabs and behave the same way across the workflow.

<h3 id="help-preprocessing-common-node-selection">Data block selection panel</h3>

Select one or more data blocks from the workspace graph or the data block list. Each tool will only work when the required number of data blocks are selected.

<h3 id="help-preprocessing-common-apply-button">Apply action</h3>

Use **Add to Workspace** or **Add to Data Block** to run the transformation. A new data block is created (or the selected data block is updated) without overwriting your source data block.

<h3 id="help-preprocessing-common-preview">Preview table</h3>

The preview pane displays the outcomes in a paginated format with an estimated size. The user can quickly check the results of different configurations before applying the pre-processing and producing a new data block to the workspace.

<h2 id="help-preprocessing-filter-section">Filter</h2>

![Filter screenshot](tutorials/assets/preprocessing/filter.png)

The filter tool keeps only the rows that match defined conditions. Use it to remove noise, focus on a subset, or create a clean working dataset before analysis. This tool accepts only one selected data block at a time.

<h3 id="help-preprocessing-filter-conditions">Filter conditions</h3>

![Filter conditions screenshot](tutorials/assets/preprocessing/filter_conditions.png)

Define one or more column-based filter conditions. Each condition can be configured differently depending on the data type of the selected column. All conditions can be combined using either AND or OR logic.
1. Use the "Add Condition" button to add additional conditions.
2. Select the combining logic for all conditions. The app does not support mixed logic chains (e.g. a mix of AND and OR).
3. Any individual condition can be negated by checking its "Negate" checkbox.
4. The preview pane displays the number of rows that match the current condition set. It is possible to produce an empty data block if no rows satisfy the conditions or if the conditions conflict with one another.

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

The Sample tool extracts either a contiguous range or a randomly selected set of rows from the selected data block. Extracting a small, representative subset of the data makes exploring and debugging quicker than working with the full-size dataset.

<h3 id="help-preprocessing-slice-offset">Slice</h3>

![Slice screenshot](tutorials/assets/preprocessing/sample_slice.png)

The slice option extracts a continuous chunk of rows from the data block. The offset parameter sets the starting row of the chunk (where the first row is 0).

<h3 id="help-preprocessing-slice-length">Length</h3>

The number of rows to include in the extraction. Leave it blank to slice until the end of the data block. To include rows 101–200, set offset = 100 and length = 100.

<h3 id="help-preprocessing-sample-fraction">Fraction/Count</h3>

![Random screenshot](tutorials/assets/preprocessing/sample_random.png)

The random sample option extracts a randomly selected set of rows from the data block. You can specify either a proportion (e.g. 30%) or a fixed number of rows (e.g. 500) from the selected data block.

For proportional sampling, enter a decimal number between 0 and 1. For example, enter 0.3 to extract 30% of the data block. For a fixed row count, enter a whole number, e.g. 100 to extract 100 rows. If the number entered exceeds the size of the data block, all rows will be extracted in a shuffled order.

<h3 id="help-preprocessing-sample-seed">Random Seed</h3>

The random seed controls the reproducibility of the random sampling process. Setting a fixed seed ensures the same rows/order are extracted each time from the **same data**.

- Use any non-negative integer (e.g. 0, 42, 12345).
- Remember the seed value when you want consistent, reproducible results.
- If you would like to have a **True Random** subset of selected data block, check the *No Random See* box after the seed control. 
  - **Warning**: This will not only generate a random sample with unknown seed (*unreproducible*) at the time of creation, but also randomly redraw the sample everytime it is accessed or analysed again. *This randomness will be passed to all derived child data blocks if you elect to sample without a seed, and the results are subject to change at each analysis.* Please only use this option for exploring the dataset.

<h3 id="help-preprocessing-slice-new-node-name">New data block name</h3>

Label the sample output so it is easy to find later. The pre-populated name includes the parameters of the selected operation.

Key controls include the data block selection panel, the sampling method dropdown, mode-specific parameter inputs, the new data block name field, the status summary, the **Add to Workspace** action, and the preview table for the output rows.

Practice exercise:

1. Pick a dataset with at least 200 rows.
2. Try Slice with offset 50 and length 25, then try Random Sample with fraction 0.2, or count 100, and a fixed seed.
3. Add each result as a new data block and compare the row count.

<h2>Join</h2>

![Join screenshot](tutorials/assets/preprocessing/join.png)

Join combines two data blocks using matching columns. Use it when your text data lives in one data block and metadata lives in another, or when you need to enrich a data block before analysis.

<h3 id="help-preprocessing-join-section">Join sub-tab overview</h3>

The Join tab guides you through selecting two data blocks, choosing the columns from each data block that share common values, and then joining both data blocks side by side based on those columns.

Depending on the join type and the common values between the two data blocks, the resulting data block can have more or fewer rows than either source, but it will include all columns from both data blocks, making it wider than either source.

<h3 id="help-preprocessing-join-column-picker">Join column picker</h3>

![Join column picker screenshot](tutorials/assets/preprocessing/join_column_picker.png)

The column pickers let you choose which column to match in each data block.

- Pick columns that represent the same identifier in both data blocks.
- Clean, consistent IDs produce the best joins.
- The app will *guess* and pre-populate the columns most likely to share common values between the two data blocks, but you are responsible for selecting the correct joining columns and join type.

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

<h2 id="help-preprocessing-find-replace">Find</h2>

![Find screenshot](tutorials/assets/preprocessing/find.png)
The Find tool supports versatile text column manipulation, including cleaning, extracting, replacing, and creating content, powered by Regular Expressions (RegEx). You need to know how to write RegEx patterns to match the words and phrases you need.

The **Find** tool supports two operations on the matched text contents, Replace or Extract. The outcomes can overwrite the same column of text or add to the data block as a new column, if the column name is defined.

![Replace screenshot](tutorials/assets/preprocessing/find_replace.png)

**Replace**: The above figure shows an example of replacing all urls in the post by empty string, hence deleting the urls and create a new column named url_removed.

![Extract screenshot](tutorials/assets/preprocessing/find_extract.png)

**Extract**: This is the example to match and extract all twitter mentions (@username) from the tweet messages, connect with space and create a new column named mentioned to include all mentioned usernames.

<h2 id="help-preprocessing-aggregate-section">Create</h2>

![Create screenshot](tutorials/assets/preprocessing/create.png)

The **Create** tab allows users to build new columns in a selected data block by merging the contents of multiple columns as text. This is useful when different columns need to be analysed as a whole, e.g. combining a title, abstract, and body text as the full article content.

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
