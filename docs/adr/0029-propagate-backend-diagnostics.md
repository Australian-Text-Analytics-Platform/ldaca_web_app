---
status: accepted
---

# Propagate backend diagnostics to every client

## Context

Generic internal-error messages made failures difficult to diagnose from the
browser or desktop application. Request IDs still required access to backend
logs, while Analysis and User File Import failures could outlive the process
log entry that explained them.

## Decision

Every deployment exposes the deepest Python exception type and complete
exception message for internal HTTP failures and failed background resources.
Expected 4xx responses retain their product messages. The diagnostic has no
length limit and may contain paths, SQL, provider response text, or other values
present in `str(exception)`.

Tracebacks remain backend-only. Child processes return exception type, message,
and traceback as separate fields; only the first two enter public or durable
resources. Responses never add stack frames, source filenames, line numbers, or
code snippets.

## Consequences

The frontend can show actionable failures without log access, and request IDs
continue to correlate HTTP diagnostics with complete backend traces. Durable
Analysis and User File Import records preserve full failure messages.

This deliberately accepts disclosure risk in hosted multi-user deployments.
There is no deployment flag and no message truncation. Failures after an HTTP or
SSE response has started cannot be converted to an error envelope and remain
log-only.
