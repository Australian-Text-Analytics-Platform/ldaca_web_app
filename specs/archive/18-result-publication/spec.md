# Run All Result Publication

Issue: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/18

## Required behavior

- Concordance and Quotation Run All compute complete immutable Result tables
  without changing the Workspace graph.
- Review pages come from those Result tables. Concordance retains Table and
  Dispersion presentation, including frontend-only dispersion values.
- **Add to Workspace** creates a typed Result Publication Supporting Analysis.
- The publication dialog requires the document column, defaults metadata
  columns off, defaults analysis columns on, and allows output names to change.
- A multi-source publication is atomic.
- Annotation remains the in-place Run All exception.
- Features without Preview execution render no Preview control.
- Native Workspace schema 10 and portable archive format 9 are accepted; older
  formats are rejected without compatibility code.

## Non-goals

- Restoring detachment endpoints, staged Concordance outputs, or materialization
  controls.
- Persisting presentation-only Concordance dispersion as a backend column.
- Changing Annotation Run All to a detached-table workflow.
