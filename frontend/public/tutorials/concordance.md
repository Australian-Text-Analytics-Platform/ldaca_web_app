<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-concordance-section">Concordance tutorial</h1>

![Concordance screenshot](tutorials/assets/concordance.png)

Concordance helps you see how a word or phrase is used by showing it in context.

> **Placeholder (image):** Screenshot of concordance results with highlighted term.

<h2 id="help-concordance-parameters">Parameter panel</h2>

Use the parameter panel to define the search term, context window, and any optional matching rules.

<h3 id="help-concordance-search-term">Concordance search term</h3>

Enter the word or phrase you want to study. The results will show the left and right context around each match.

**Q: Should I use quotes for phrases?**

If you want an exact phrase, use quotes or enable regex and specify the pattern explicitly.

<h3 id="help-concordance-regex-toggle">Regex mode toggle</h3>

Regex mode lets you use patterns for advanced matching (e.g., word variants).

- Use it when you need flexible matching.
- Turn it off for exact, literal searches.

<h2 id="help-concordance-results">Result panel</h2>

Use the result panel to review keyword-in-context hits and compare separated versus combined views.

The pagination footer shows **Documents searched per page (N matches found)** so you can tell how many source documents on the current page produced at least one concordance row.

If a source document on that page does not contain the search term, it does not produce a row in the result table.

<h3 id="help-concordance-clear-results">Clear results</h3>

Concordance results are saved in the backend so the tab can reload and preserve your last results. **Clear Results** clears the cached result in the backend and resets the tab state.

## Practice exercise

1. Search for a keyword from your text data.
2. Turn on regex and search for a simple pattern (like `love|loved|loving`).
3. Compare the contexts you get in each mode.

[← Back to tutorial index](./index.md)
