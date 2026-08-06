# Implementation Plan

1. Replace the four analysis request, Result, worker, provenance, and persisted
   contracts with Derived Data Block Creation names and bump strict formats.
2. Add per-source Select all and Select none controls to the two Add to
   Workspace dialogs, preserving required columns and stable submission order.
3. Remove obsolete frontend column-selection state and migrate contextual-hint
   IDs.
4. Align the glossary, accepted ADRs, current architecture/reference pages, and
   user documentation while retaining historical records.
5. Regenerate OpenAPI, run full package and documentation checks, and complete
   browser acceptance before coordinating Issues #25 and #24.
