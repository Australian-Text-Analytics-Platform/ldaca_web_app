# Implementation Plan

1. Change `polars-text` to retain raw term counts beside its internal c-TF-IDF
   ranking, emit a list of representative-word structs, fix the candidate
   capacity at 100, remove compute-time stopwords, and cut source metadata to
   0.5.0.
2. Change backend Topic request, worker, Result, and publication projections to
   the structured contract; remove the unused Token Frequency request field.
3. Extend the Tab domain and PATCH API with normalized stopwords and the Topic
   visual cap. Preserve both fields through every Analysis lifecycle path and
   bump native/archive formats.
4. Regenerate OpenAPI and the TypeScript client, then update Topic Modelling
   projections to filter, slice, and search without a synthetic label.
5. Extract shared stopword and word-cloud primitives. Add the two feature-
   specific control presentations, optimistic Tab mutation/rollback, and the
   compact accessible Topic tooltip.
6. Update glossary, domain, API, package, state-flow, and user documentation.
   Keep the specification active until source and manual verification finish.
7. Run focused tests followed by package and repository gates. Record the
   deferred 0.5.0 publication as the only standalone-backend rollout blocker.
