---
status: accepted
---

# Classify provider failures and publish only trustworthy Annotation output

The fixed-message exposure rule in this ADR is superseded by
[ADR 0029](0029-propagate-backend-diagnostics.md). Stable classification,
retry, splitting, and publication behavior remains in force.

Wordflow normalizes external Annotation SDK failures to stable codes:

- `annotation_provider_authentication_failed`;
- `annotation_provider_access_denied`;
- `annotation_provider_rate_limited`;
- `annotation_provider_request_rejected`;
- `annotation_provider_unavailable`;
- `annotation_provider_context_limit`;
- `annotation_provider_invalid_response`;
- `annotation_provider_failed` as the fallback.

Synchronous model discovery and Preview expose the stable code plus complete
diagnostic as HTTP 502. Backend logs additionally retain the traceback.

Authentication, access, and rejected requests fail immediately. Rate limits and
unavailability retry within the request's configured bounds. Context limits
split immediately. Invalid responses retry before splitting. Exhausted
authentication, access, rejection, rate-limit, unavailable, and unknown
failures are provider-wide and fail the whole Run All without publishing a Data
Block mutation.

Only irreducible single-row context-limit or invalid-response failures permit
partial publication. A separate failed-row mask distinguishes inference
failure from a successful explicit `null`: failed rows preserve their previous
value in `reprocess_all` and stay blank in `fill_missing`, while a successful
`null` may clear a value. Failed-row and failed-batch counts remain durable.

Workers return a private validated failure envelope so fatal codes and
diagnostics survive the process boundary without publishing an artifact. Fatal
failures appear both in Annotation and the durable Tasks entry. Partial counts
appear beside the Annotation result only.
