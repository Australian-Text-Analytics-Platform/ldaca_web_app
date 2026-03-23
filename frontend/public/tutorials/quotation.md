<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-quotation-section">Quotation extraction tutorial</h1>

![Quotation extraction screenshot](tutorials/assets/quotation_extraction.png)

Quotation extraction finds quoted segments in text and adds context around them. It is useful for analyzing reported speech or citations.

> **Placeholder (image):** Example of quotation extraction results with context columns.

<h2 id="help-quotation-parameters">Parameter panel</h2>

Use the parameter panel to select the text column and configure the context window.

<h3 id="help-quotation-context-length">Quotation context length</h3>

This setting controls how many words are captured before and after a quotation.

- Short context is good for quick scanning.
- Longer context helps interpret meaning.

**Q: How long should the context be?**

Start with a modest length (e.g., 5–10 words on each side) and adjust based on readability.

<h2 id="help-quotation-results">Result panel</h2>

Use the result panel to review extracted quotations and metadata.

The pagination footer shows **Documents searched per page (N matches found)** so you can see how many source documents on the current page produced at least one quotation row.

If a source document on that page has no extracted quotation, it does not appear as a row in the result table.

<h3 id="help-quotation-clear-results">Clear results</h3>

Quotation results are saved in the backend so the tab can reload and keep persistent pages. **Clear Results** clears the cached result in the backend and resets the tab.

## Practice exercise

1. Run quotation extraction with a short context length.
2. Increase the context length and compare the results.
3. Decide which setting supports your research question best.

[← Back to tutorial index](./index.md)
