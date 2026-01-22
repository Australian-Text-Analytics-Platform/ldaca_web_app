<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1>Preprocessing: Join tutorial</h1>

Use the Join sub-tab to combine two datasets into one. This is useful when your text data lives in one table and metadata lives in another.

> **Placeholder (image):** Screenshot of the Join tab with column picker and join type selector.

<h2 id="help-preprocessing-join-section">Join sub-tab overview</h2>

The Join sub-tab guides you through selecting two datasets, choosing join columns, and producing a new combined node.

**Q: What does “join” mean?**

A join combines rows from two tables based on matching values in a shared column (like an ID).

<h2 id="help-preprocessing-join-column-picker">Join column picker</h2>

This selector chooses the column used to match rows across the two datasets.

- Pick a column that exists in **both** datasets.
- Choose a column with clean, consistent IDs.

<h2 id="help-preprocessing-join-type">Join type selector</h2>

Join type controls how unmatched rows are handled.

- **Inner join:** keep only matching rows.
- **Left join:** keep all rows from the left table.
- **Full join:** keep all rows from both tables.

**Q: Which join type should I use?**

Start with **inner join** if you only want matched pairs. Use **left join** if the left table is the primary source.

<h2 id="help-preprocessing-join-node-name">Join output name</h2>

Give the new joined dataset a clear name so it is easy to find later.

- Example: `corpus_with_metadata`.
- Use a name that explains the source tables.

<h2 id="help-preprocessing-join-apply">Apply join</h2>

Click Apply to run the join and create a new node in the workspace graph.

- The new node appears after the join completes.
- You can keep the original nodes for comparison.

## Practice exercise

1. Select two datasets that share a document ID column.
2. Choose that ID in the join column picker.
3. Run an inner join.
4. Compare the row count before and after.

[← Back to tutorial index](./index.md)
