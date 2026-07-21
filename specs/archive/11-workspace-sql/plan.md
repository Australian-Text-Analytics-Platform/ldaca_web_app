# Implementation Plan

1. Add strict query/create request models and SQL provenance.
2. Add a temporary-context SQL service behind the Workspace read and mutation
   gates.
3. Add the mixed Arrow/JSON HTTP endpoint and remove node rows.
4. Regenerate OpenAPI and the frontend client.
5. Add a handwritten SQL table adapter and migrate every row consumer.
6. Make categorical options use ordered distinct SQL pagination and server-side
   search.
7. Update durable documentation and archive this record after verification.

## Verification

- Backend Ruff and Ty passed.
- Backend Pytest passed: 489 tests, with one opt-in Jieba download test skipped.
- Frontend Vitest passed: 198 files and 773 tests.
- Frontend lint, tooling typecheck, Knip, build, documentation drift, and
  version checks passed.
- Browser acceptance covered categorical loading/search and Data View paging.
- Markdown links and root/backend `git diff --check` passed.
- The aggregate frontend format check remains blocked only by seven unrelated
  pre-existing dirty-worktree files; all files changed for this interface pass
  the formatter.
