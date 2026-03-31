<!-- markdownlint-disable MD033 MD041 -->

[← Back to tutorial index](./index.md)

<h1 id="help-concordance-section">Concordance tutorial</h1>

![Concordance screenshot](tutorials/assets/concordance.png)

The Concordance tool searches a word or phrase in the text collection and display how the matches are used in context.

> **Placeholder (image):** Screenshot of concordance results with highlighted term.

<h2 id="help-concordance-parameters">Parameter panel</h2>

Use the parameter panel to define the search term, context window, and other optional matching rules.

<h3 id="help-concordance-search-term">Concordance search term</h3>

Enter the word or phrase you want to study. The results include the left and right context around each match. The user can choose to display any additional metadata from the data block.

<h3 id="help-concordance-regex-toggle">Regex mode toggle</h3>

Regex mode lets you use patterns for advanced matching (e.g., word variants).

- Use it when you need flexible matching.
- Turn it off for exact, literal searches.

**Q: Can I search for multiple words at one time?**

The concordance tool accepts only one input search term. However, if you choose to use regular expression (RegEx) as your search term, it's possible to compile a pattern that matches multiple words. The user is responsible to design their RegEx search pattern, and the follows are a few simple examples. Alternatively, the user can excute several concordance searches with different terms, detach the results and use the pre-processing Stack tool to connect the results.

**Example RegEx patterns**

*child(ren)?* or *child|children*: Match the words: *child* or *children*.
*\w{2}-\d{4,6}*: Match pattern start with two letters (\w), delimited by dash (-), then followed by 4 to 6 digits (\d). Such as id-4589, or SA-398871.
*\w+\sof\s\w+*: Match a phrase with an *of* in the middle, such as *pattern of RegEx*, *right of worker*.

<h2 id="help-concordance-results">Result panel</h2>

Use the result panel to review keyword-in-context hits. Every time the concordance tool sends a group of documents for matching, and the group size can be defined with the dropdown selection in the pagination footer that shows **Documents searched per page (N matches found)**, so the user can tell how many source documents on the current page are searched and produced how many matches.

When a less common term is searched, when all source documents on that page do not contain the search term, the results will be empty.

When two data blocks are selected for the comparative concordance analysis, there are two view modes of the results: **Table View** and **Dispersion View**, and either view can be displayed in *separated* or *combined* way.

![Table separated view mode](tutorials/assets/concordance/table_view.png)
Under the table view mode, each row of the result is one hit of the search term, and if there are multiple matches from the same document, the results will be displayed in multiple rows.

![Dispersion combined view mode](tutorials/assets/concordance/dispersion_view.png)
Under the dispersion view mode, each row represents one document, and all matches in that document are plotted as vertical lines on a horizontal bar. The positions of the lines indicate the relative locations of the identified matches within the document, and the user can choose to scale the bar to the same length or according to the character length of each document.

When combined display mode is chosen, similar to the token frequency analysis tool, the background colour of results stand for their source data blocks.

![Concordance detach](tutorials/assets/concordance/detach_datablocks.png)

The **detach** or **detach both** button in the result pane extracts the full search outcomes as new derived data blocks of the source data blocks, which become visible in the workspace graph view. The detached concondance data block is automatically named as *originalName*_conc, and this can be renamed later.

![Concordance detach](tutorials/assets/concordance/detach_metadata.png)

At the start of detaching process, the user can decide which metadata should be inherited to the detached datablock, the user is suggested consider further analytic needs when making the selection of metadata. 

<h3 id="help-concordance-clear-results">Clear results</h3>

Concordance results are saved in the backend so the tab can reload and preserve your last results. **Clear Results** clears the cached result in the backend and resets the tab state.

## Practice exercise

1. Search for any keyword from your text data.
2. Turn on regex and search for a simple pattern (e.g. `love|loved|loving`).
3. Use Token Frequency tool to explore the common words that lead or after the search term.
4. Think about what can you do if you need to futher analyse contents from a 30 words window surrounding the search terms.

[← Back to tutorial index](./index.md)
