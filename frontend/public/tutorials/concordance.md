<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-concordance-section">Concordance tutorial</h1>

![Concordance screenshot](tutorials/assets/concordance.png)

The Concordance tool searches for a word or phrase in the text collection and displays how each match is used in context.

> **Placeholder (image):** Screenshot of concordance results with highlighted term.

<h2 id="help-concordance-parameters">Parameter panel</h2>

Use the parameter panel to define the search term, context window, and other optional matching rules.

<h3 id="help-concordance-search-term">Concordance search term</h3>

Enter the word or phrase you want to study. The results include the left and right context around each match. You can choose to display additional metadata from the data block alongside the results.

<h3 id="help-concordance-regex-toggle">Regex mode toggle</h3>

Regex mode lets you use patterns for advanced matching (e.g., word variants).

- Use it when you need flexible matching.
- Turn it off for exact, literal searches.

**Q: Can I search for multiple words at once?**

The concordance tool accepts a single search term. However, if you use a [regular expression (RegEx)](https://en.wikipedia.org/wiki/Regular_expression) as your search term, you can write a pattern that matches multiple words. You are responsible for [designing the RegEx pattern](https://regexr.com/); a few simple examples are shown below. Alternatively, you can run several concordance searches with different terms, detach the results, and use the pre-processing Stack tool to combine them.

**Example RegEx patterns**

*child(ren)?* or *child|children*: Matches *child* or *children*.
*\w{2}-\d{4,6}*: Matches a pattern starting with two letters (`\w`), followed by a dash, then 4 to 6 digits (`\d`) — e.g. *id-4589* or *SA-398871*.
*\w+\sof\s\w+*: Matches a phrase with *of* in the middle — e.g. *pattern of RegEx*, *right of workers*.

<h2 id="help-concordance-results">Result panel</h2>

Use the result panel to review keyword-in-context hits. The concordance tool searches documents in pages; the page size can be set using the dropdown in the pagination footer, which also shows **Documents searched per page (N matches found)**. This tells you how many source documents were searched on the current page and how many matches they produced.

If the search term is uncommon and none of the documents on the current page contain it, the results will be empty.

When two data blocks are selected for comparative concordance analysis, two view modes are available: **Table View** and **Dispersion View**. Either view can be displayed in *separated* or *combined* mode.

![Table separated view mode](tutorials/assets/concordance/table_view.png)
In table view, each row represents one match. If a document contains multiple matches, each match appears as a separate row.

![Dispersion combined view mode](tutorials/assets/concordance/dispersion_view.png)
In dispersion view, each row represents one document, and all matches within that document are plotted as vertical lines on a horizontal bar. The position of each line indicates the relative location of the match within the document. You can choose to scale all bars to the same length or scale them proportionally to the character length of each document.

When combined display mode is selected, the background colour of each result indicates its source data block, similar to the token frequency analysis tool.

![Concordance detach](tutorials/assets/concordance/detach_datablocks.png)

The **Detach** or **Detach Both** button in the result panel extracts the full search results as new derived data blocks, which become visible in the workspace graph view. Each detached concordance data block is automatically named *originalName*_conc and can be renamed later.

![Concordance detach](tutorials/assets/concordance/detach_metadata.png)

At the start of the detaching process, you can select which metadata columns to carry over to the detached data block. Consider your downstream analysis needs when making this selection.

<h3 id="help-concordance-clear-results">Clear results</h3>

Concordance results are saved in the backend so the tab can reload and preserve your last results. **Clear Results** removes the cached result from the backend and resets the tab state.

## Practice exercise

1. Search for any keyword from your text data.
2. Turn on regex and search for a simple pattern (e.g. `love|loved|loving`).
3. Use the Token Frequency tool to explore the words that most commonly appear before or after the search term.
4. Consider how you might further analyse the content within a 30-word window surrounding the search terms.

[← Back to tutorial index](./index.md)
