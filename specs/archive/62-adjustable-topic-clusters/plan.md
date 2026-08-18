# Implementation Plan

1. Add the immutable Topic clustering context and deterministic weighted Ward
   cuts to `polars-text`, then generate the natural Result through the shared
   projector.
2. Replace public Minimum topic size contracts with Result-time cluster-count
   projection, strict error handling, and authoritative projected Topic JSON.
3. Add Tab presentation persistence and make Topic Data Block Creation
   reproduce the displayed projection from the parent context.
4. Add the accessible shadcn Result slider and one explicit no-store projection-
   attempt lifecycle with request cancellation, stale-response isolation,
   whole-panel loading/error behavior, one-shot persistence, interaction resets,
   and export and Add-to-Workspace count capture.
5. Bump strict Workspace and archive versions, add ADR 0024, update durable and
   user documentation, refresh screenshots, and synchronize the publication
   mirror.
6. Run focused and package-wide tests, verify documentation and generated API
   clients, and complete the two-corpus live acceptance workflow.
