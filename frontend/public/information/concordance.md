<!-- markdownlint-disable MD033 -->

<h2 id="info-concordance-overview">About Concordance Search</h2>

A concordance shows every match from the current source-document page with its
left and right context. It supports close reading, comparison, and dispersion
analysis without materializing a whole-corpus result in the browser.

- What do I select?
  Add one or two Data Blocks and choose a source text column for each. Document
  Column and Tokenizer Preferences initialize fresh selectors independently;
  reopening an Analysis restores the exact values stored in its immutable
  request.

- Which search mode should I use?
  **Text** supports whole-word, regular-expression, and case-sensitive search
  over the selected source column. **Tokens** performs exact-token matching and
  requires a tokenizer for every selected Data Block.

- How are Results paged?
  **Documents per batch** controls how many source documents are evaluated for
  the current page. Documents without a match are omitted, while one document
  can produce several rows. Page, page-size, and source-metadata sort changes
  are projections of the same completed Analysis and retained input snapshot;
  they do not re-run against a mutable Data Block.

- What can I sort?
  Source metadata headers are sortable in separated per-Data-Block tables.
  Generated `CONC_*` headers and combined-table headers are display-only because
  those values are produced after source paging.

- What does Add to Workspace use?
  It creates a Child Analysis from the completed Concordance request and its
  retained snapshot, including the recorded search mode and tokenizer mapping.
  Later changes to Data Block preferences do not alter that historical run.

- Where can I get help?
  See the full Concordance tutorial in Help, or use the Feedback button in the
  sidebar to contact the Sydney Informatics Hub development team.
