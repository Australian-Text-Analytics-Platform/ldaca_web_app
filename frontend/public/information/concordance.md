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
  requires a tokenizer for every selected Data Block before running. Fresh
  Concordance Analyses start in Text mode; selecting Tokens enables the
  tokenizer controls.

- How does punctuation affect context?
  Text mode starts with **Ignore punctuation** on. Punctuation and symbol-only
  tokens remain visible in the original context but do not consume the context
  count or become L1/R1. Search matching itself is unchanged. Tokens mode
  already filters punctuation through its tokenizer and therefore hides this
  Text-only option.

- How are Results paged?
  **Documents per page** controls how many source documents are evaluated for
  the current page. Documents without a match are omitted, while one document
  can produce several rows. Page, page-size, and source-metadata sort changes
  are projections of the same completed Analysis and retained input snapshot;
  they do not re-run against a mutable Data Block.

- What can I sort?
  In separated Preview tables, selected source metadata is sortable and
  generated scalar headers explain that Run All is required. After Run All,
  separated Review tables also sort materialized matched text, L1/R1, their
  frequencies, and match offsets. String ordering is case-sensitive and equal
  values have no guaranteed secondary order. Full document and left/right
  context strings remain display-only, as do all combined-table headers.

- What are L1 and R1?
  **L1** is the token immediately left of a match; **R1** is the token immediately
  right. Their frequency columns count those values across the complete Run All
  Result. Table View gives matched text strong source-colour emphasis, then
  highlights the last exact L1 occurrence in the left context and first exact
  R1 occurrence in the right context with a softer tint. Empty, missing, or
  case-mismatched anchors remain plain. **Highlight L1/R1 in context** is on by
  default and controls only those inline tints for the current tab session;
  direct L1/R1 cells remain plain.

- What do Preview, Run All, and Review do?
  **Preview** creates a Preview Analysis and computes only the page you request.
  **Run All** may be started directly and creates one Run All group with one
  Supporting Analysis and immutable table Result per source. **Review** reads
  those Results directly. Table View pages matches. Dispersion View pages
  qualifying source rows and charts one series per exact, case-sensitive term
  over the complete Result. In Review, hidden terms and selected bins filter
  documents, markers, counts, and Data Block Creation before sorting and
  paging. **Add to Workspace** starts Concordance Match Data Block Creation
  from Table View or Concordance Document Data Block Creation with required
  `CONC_extraction` from Dispersion View. With two sources, you can include
  either or both in one atomic request.

- Where can I get help?
  See the full Concordance tutorial in Help, or use the Feedback button in the
  sidebar to contact the Sydney Informatics Hub development team.
