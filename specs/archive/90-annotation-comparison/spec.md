# Annotation Comparison Consistency

Issue: [#90](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/90)

Annotation comparison must use one Codebook-aware label rule across display,
row filtering, difference tinting, reliability counts, and SQL. Selected
comparisons remain masked row by row until revealed, while their reliability
score, exact confusion matrix, and filter remain available. Manual and Review
support one mount-local filter owned by the annotation column or one comparison
column; Preview remains unfiltered because its rows belong to the AI request.

Manual, Preview, and Review preserve raw editable values, including legacy and
whitespace-padded values, while offering canonical Codebook replacements. They
share a persisted, bounded, resizable table height and a text-first column
layout. The Cohen's Kappa calculation is unchanged.

This is a frontend-only change. It does not alter backend APIs, OpenAPI,
persistence schemas, or generated clients.
