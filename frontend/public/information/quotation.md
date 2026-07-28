<!-- markdownlint-disable MD033 -->

<h2 id="info-quotation-overview">About Quotation Extraction</h2>

Quotation Extraction identifies quoted speech, speakers, and speech verbs in
English news-style text. The built-in rules are based on the
[Gender Gap Tracker](https://github.com/sfu-discourse-lab/GenderGapTracker)
and were developed for Canadian news, so validate a representative sample when
working with another genre or English variety.

- What do I select?
  Add one Data Block and choose its source text column. A fresh selector uses
  the Data Block's Document Column Preference when available, while a reopened
  Analysis keeps the exact column stored in its immutable request.

- Which engine should I use?
  **Built-in** runs the bundled local quotation engine and requires no service
  configuration. **Remote** uses an engine ID configured by the deployment
  operator; it does not accept an arbitrary service URL. Ask the operator for a
  valid ID and confirm that the service's data-handling policy is suitable.

- What do Preview, Run All, and Review do?
  **Preview** creates a Preview Analysis and computes requested pages from its
  retained input snapshot. **Run All** may be started directly and creates an
  independent Run All Analysis with a complete immutable table Result.
  **Review** reads that Result directly and can page by highlighted documents
  or raw quotation matches. **Add to Workspace** publishes selected
  columns as a Derived Data Block only when you request it.

- How does sorting work?
  The `QUOTE_extraction` header sorts by the selected source text column, and
  source metadata columns remain sortable. Generated quotation fields are
  display-only.

- Where can I read more?
  See the [open access article](https://doi.org/10.1515/cllt-2023-0104), the
  [ATAP overview](https://www.atap.edu.au/posts/quotation-tool/), or the full
  Quotation tutorial in Help.

- Where can I get help?
  Use the Feedback button in the sidebar to contact the Sydney Informatics Hub
  development team.
