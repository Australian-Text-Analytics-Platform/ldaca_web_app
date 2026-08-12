---
status: accepted
---

# Classify provider failures and publish only trustworthy Annotation output

External Annotation SDK failures cross a safety boundary. Wordflow normalizes
them to stable codes and fixed messages:

- `annotation_provider_authentication_failed`;
- `annotation_provider_access_denied`;
- `annotation_provider_rate_limited`;
- `annotation_provider_request_rejected`;
- `annotation_provider_unavailable`;
- `annotation_provider_context_limit`;
- `annotation_provider_invalid_response`;
- `annotation_provider_failed` as the fallback.

Synchronous model discovery and Preview expose these safe failures as HTTP 502.
They never expose SDK messages, response bodies, provider URLs, or credentials.
Raw causes exist only in request- or Analysis-correlated backend logs.

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

Workers return a private validated failure envelope so fatal codes and safe
messages survive the process boundary without publishing an artifact. Fatal
failures appear both in Annotation and the durable Tasks entry. Partial counts
appear beside the Annotation result only.
