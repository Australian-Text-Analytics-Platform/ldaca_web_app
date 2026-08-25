---
status: accepted
---

# Quotation Preview Uses Arrow IPC

## Context

Quotation Preview returned grouped rows as JSON while Run All Review returned
Arrow IPC. The frontend therefore projected equivalent quotation data through
different value models. In particular, generic Arrow display normalization
converted `Int64` offsets to strings before the Run All quotation renderer saw
them, so its span labels disappeared while Preview continued to render.

## Decision

Quotation Preview has a dedicated Arrow IPC query endpoint. It returns one row
per matching document in the requested source-document page, preserves source
columns, and adds `quotation: List<Struct<...>>` with `Int64` offsets. The
stored Preview Result remains a ready marker and pages remain projections of
the retained immutable snapshot.

Preview and Run All keep their separate lifecycles and transports, then enter
one frontend Arrow-native quotation projector. Feature code reads native Arrow
table and nested vector values. JSON-friendly row normalization remains a
display-only facility for ordinary tables and is not a semantic analysis
boundary.

The generic JSON Result query no longer accepts Quotation. There is no JSON
fallback or transition period.

## Consequences

- Preview and Run All share quotation grouping, canonical field mapping,
  metadata filtering, clipping, label, and detail-view behavior.
- `bigint` offsets remain native until span normalization, which accepts only
  non-negative safe integers within document code-point bounds.
- Preview pagination is based on all source documents, so a sparse empty page
  may still advertise a later page.
- Preview and Review retain independent page state and defaults.
