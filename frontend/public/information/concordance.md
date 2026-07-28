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
  **Documents per page** controls how many source documents are evaluated for
  the current page. Documents without a match are omitted, while one document
  can produce several rows. Page, page-size, and source-metadata sort changes
  are projections of the same completed Analysis and retained input snapshot;
  they do not re-run against a mutable Data Block.

- What can I sort?
  Source metadata headers are sortable in separated per-Data-Block tables.
  Generated `CONC_*` headers and combined-table headers are display-only because
  those values are produced after source paging.

- What do Preview, Run All, and Review do?
  **Preview** creates a Preview Analysis and computes only the page you request.
  **Run All** may be started directly and creates one Run All group with one
  Supporting Analysis and immutable table Result per source. **Review** reads
  those Results directly. Table View pages by matches; Dispersion View can page
  by matches or documents. Its density chart covers the complete Result rather
  than the visible page. Separated/Combined, metadata, sorting, and row-detail
  controls remain available.
  **Add to Workspace** lets you publish selected Result columns as Derived Data
  Blocks after the computation succeeds.

- Where can I get help?
  See the full Concordance tutorial in Help, or use the Feedback button in the
  sidebar to contact the Sydney Informatics Hub development team.
