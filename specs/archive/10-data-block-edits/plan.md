# Implementation plan

## Boundaries

1. Add bounded plan history to the Data Block domain object and preserve it
   across rejected Workspace publications.
2. Add pure edit-plan builders, metadata reconciliation, service commands, and
   the edit/Undo/Redo HTTP resources.
3. Remove cast from creation input while retaining historical cast provenance,
   then regenerate the frontend OpenAPI client.
4. Add the preprocessing result mode to eligible tools only, route column
   controls through edits, and restore both requested history surfaces.
5. Update the glossary, ADR, backend architecture/reference, and tutorials.
6. Complete focused and full verification before archiving this spec.

## Mutation sequence

For one edit under the Workspace mutation gate:

1. Resolve the target Data Block and reject a missing or Analysis-reserved
   target.
2. Build and validate the candidate lazy plan without mutation.
3. Detect a semantic no-op before assigning the plan.
4. Assign the plan, which records the previous plan and clears Redo.
5. Reconcile document and tokenization metadata with the resulting schema.
6. Persist the current plan and publish the next Workspace revision.
7. If publication fails, reload the committed Workspace and restore the
   captured runtime-only plan stacks.

Undo and Redo move plans between stacks without invoking automatic history
recording, reconcile metadata, and use the same publication sequence.

## Risks and controls

- LazyFrame objects have no stable value equality. No-op detection is
  operation-specific: identical casts/renames/deletes are rejected or skipped
  before plan assignment, while transformation requests that produce a new
  execution plan create one checkpoint.
- Metadata is deliberately outside plan history. Every forward or history
  command clears references absent from the restored schema, and rename
  retargets references before the common reconciliation step.
- The working tree contains unrelated active changes. Edits remain limited to
  the feature's domain, service, API, generated client, UI surfaces, tests, and
  canonical documentation.

## Verification

- Backend: focused domain/service/API/persistence tests, Ruff, ty, full Pytest,
  and OpenAPI export.
- Frontend: focused preprocessing/column/history tests, generated-client tests,
  lint, full Vitest, and production build.
- Repository: documentation checks and links plus `git diff --check`.
- Browser: dtype edit plus Undo/Redo, Filter create/update modes, frozen
  descendant, and close/reopen history reset.
