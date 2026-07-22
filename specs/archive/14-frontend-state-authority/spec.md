# Eliminate Competing Frontend State Authorities

GitHub issue: [#14](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/14)

## Objective

Make backend resources observed through TanStack Query the only authority for
open Workspaces, Tabs, Analyses, Results, imports, SQL pages, and schemas.
Client stores retain only interaction and device-local state.

## Required behavior

- A user has at most one `open` Workspace. Concurrent lifecycle commands are
  serialized per user, while different users remain independent. Busy siblings
  may remain `closing`.
- The frontend derives the current Workspace from the sole backend resource
  whose `runtime_state` is `open`; zero open means no selection and more than
  one is an explicit invariant error.
- Task Inbox and completed Results are projections of Query-owned backend
  resources, not Zustand or component mirrors.
- Root Analyses use one Tab submission contract. Child detachments remain
  Workspace mutations.
- Manual Annotation mutates a Data Block through `set_cell` and
  `annotation_classes` edits. AI preview is stateless and AI Run is a durable
  Annotation Analysis.
- Device-local state is versioned and scoped by user and Workspace, and stale
  resource identifiers are pruned after authoritative hydration.

## Non-goals

- Moving credentials out of their documented deployment-mode ownership split.
- Replacing URL/view synchronization, pre-auth Session bootstrap, guidance
  overlays, or client-only form drafts.
- Adding compatibility fallbacks for removed frontend authorities.

## Verification

Backend concurrency, lifecycle-event, edit-history, persistence, and API tests;
frontend authority, query-key, Analysis submission, Annotation, pruning, and
handoff tests; complete package checks; and browser acceptance for Workspace
switching and durable Analysis/Annotation behavior.
