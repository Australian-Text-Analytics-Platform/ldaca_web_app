# Plan

1. Change Concordance and Quotation workers to store matching documents with
   nested occurrence structs and explicit document/match counts.
2. Add match/document Result projections and a whole-Result Concordance density
   resource, preserving deterministic source and occurrence ordering.
3. Keep Result Publication flat by projecting matches before selecting output
   columns.
4. Replace frontend flat-page regrouping with unit-aware Review models and
   connect the new Concordance and Quotation controls.
5. Cut Workspace schema to 13 and archive format to 12, regenerate OpenAPI and
   the frontend SDK, and update durable documentation and ADR 0018.
6. Convert the local Test Workspace operationally, complete package checks and
   browser acceptance, then archive this specification.

## Risks

- Match projection must retain global Concordance frequency values and stable
  ordering when one document crosses a page boundary.
- Whole-Result density must not become page-keyed or introduce mutable backend
  cache state.
- The shared projection path must not alter Topic Modeling's existing flat
  paged table contract.
- Generated-client changes must preserve unrelated export work already present
  in the worktree.
