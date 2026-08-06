# Implementation Plan

1. Add exact-term/bin-filtered document projection over the immutable nested
   Result, including filtered total rows.
2. Split Concordance Match and Document Publication request, Result, worker,
   provenance, and persistence contracts.
3. Render per-term Preview and Review series; make Review filters drive the
   projection and view-specific publication payload.
4. Add source inclusion to the Concordance publication dialog while leaving
   Quotation unchanged.
5. Align durable and user documentation, regenerate OpenAPI, and run package
   verification.
