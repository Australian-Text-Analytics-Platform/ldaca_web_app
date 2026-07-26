# Plan

1. Replace the singleton Tab Analysis link with ordered Analysis identifiers and
   generic parent/supersession metadata.
2. Expose plural Tab Analysis collection operations and one generic submission
   envelope.
3. Execute Preview and Run All independently. Model multi-source Concordance as
   a thin Run All group with per-source Supporting children and atomic output
   publication.
4. Project each Tab forest through one TanStack Query owner and derive feature
   lifecycle controls from it.
5. Hydrate current controls from the newest applicable immutable request and
   render Run All Review from current output Data Blocks.
6. Cut native Workspace schema to 9 and portable archive format to 8, regenerate
   OpenAPI and the frontend SDK, and remove superseded contracts.
7. Update the domain, architecture, API reference, glossary, and ADR before
   archiving this specification.

## Risks

- Group cancellation must not signal the unscheduled thin Concordance root as a
  worker process.
- A failed Supporting Analysis must prevent all Concordance group outputs from
  becoming visible.
- Review SQL must never project `CONC_dispersion`; the frontend must rebuild it
  from physical occurrence rows.
- Historical Tabs must hydrate from immutable Analysis requests without
  recreating a feature-owned lifecycle cache.

## Verification

- Backend Ruff, Ty, pytest, exact OpenAPI surface, schema/archive round trips,
  old-version rejection, and grouped Concordance tests.
- Frontend formatting, lint, type checking, tests, Knip, build, documentation
  drift, and version checks.
- Documentation links and `git diff --check` in both repository boundaries.
- Browser acceptance for direct Run All, Preview update, tab switching,
  two-source Concordance, Review Table/Dispersion, Stop, and Clear.
