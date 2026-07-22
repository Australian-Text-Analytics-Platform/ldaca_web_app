# Implementation Plan

1. Add the per-user Workspace lifecycle gate and route public open/close
   commands through it.
2. Extend the Data Block edit union with `set_cell` and
   `annotation_classes`, preserving existing mutation/history semantics.
3. Regenerate the OpenAPI client.
4. Derive current Workspace and server-resource projections exclusively from
   TanStack Query, removing competing Zustand/local mirrors.
5. Standardize Analysis commands and implement durable Concordance handoff.
6. Split manual and AI Annotation into their intended edit/query/Analysis
   paths.
7. Scope and prune intentional device-only stores.
8. Update ADR and durable documentation, run complete verification, then
   archive this change record.
