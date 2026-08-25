# Quotation Preview Arrow IPC

Issue: [#67](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/67)

Quotation Preview must return native Arrow IPC and share one quotation-page
projection model with Run All Review. The generic JSON Result query must reject
Quotation, and the stored Preview Result remains a durable ready marker.

Acceptance requires native nested `List<Struct>` data, `Int64` offsets, sparse
source pagination, equivalent Preview and Run All presentation state, and no
quotation semantic reads from JSON-friendly Arrow display rows.
