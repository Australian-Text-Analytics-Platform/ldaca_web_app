# Plan

1. Make Concordance and Quotation Run All workers publish complete Analysis
   table Artifacts instead of Data Blocks.
2. Add strict Result descriptors and typed Result Publication requests,
   workers, Results, and provenance.
3. Project Review pages from immutable Result table endpoints and preserve the
   existing feature presentation.
4. Add the shared publication dialog and supporting mutation while removing
   obsolete detachment and staged-output paths.
5. Cut Workspace schema to 10 and archive format to 9, regenerate OpenAPI and
   the frontend SDK, and update durable documentation.
6. Verify backend, frontend, documentation, and browser behavior before
   archiving this specification.

## Risks

- A Concordance group must preserve source order and succeed only after every
  source Result is durable.
- Result Publication must publish every selected source or none.
- Review must not depend on mutable Workspace SQL or a source Data Block that
  may later be removed.
- `CONC_dispersion` must remain presentation-only.
