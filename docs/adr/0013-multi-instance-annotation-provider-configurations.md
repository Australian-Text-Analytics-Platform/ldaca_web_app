---
status: accepted
---

# Model Annotation providers as named configurations

One credential slot per provider type could not represent two keys for the
same service, a self-hosted OpenAI-compatible endpoint, or the exact provider
identity used by a historical Analysis. Treating a provider type or display
name as identity would also make renames and key rotation silently change the
meaning of retained work.

Wordflow therefore models an ordered **Annotation Provider Configuration**
collection. Each configuration has an opaque UUID, duplicate-allowed display
name, provider type, immutable provider locator, and one optional write-only
Provider Credential. Built-ins require a key. Custom OpenAI-compatible
configurations may be keyless. Built-in semantic identity is provider type plus
key; Custom identity is normalized base URL plus key-or-absence. Duplicate
identities are rejected, while names may repeat. Only a name changes in place;
credential rotation, provider changes, and URL changes create a new identity.

Ownership remains deployment-mode specific. Single-user configurations use
strict `users/root/provider-credentials.toml` schema 2. Multi-user
configurations and secrets use the authenticated user's partition of
`wordflow-provider-credentials` localStorage version 2. The frontend passes a
multi-user secret only at the final request boundary. Backend summaries,
frontend Query state, mutation state, Tabs, logs, and telemetry contain safe
metadata only. This preserves the storage boundary established by
[ADR 0009](0009-mode-specific-provider-credential-ownership.md) while
superseding its fixed-slot and browser-version-1 data shape.

An immutable Annotation Analysis retains the chosen configuration UUID,
provider type, normalized Custom base URL, and model. It never retains the
display name or credential. Single-user execution verifies the request
snapshot against the stored configuration; multi-user execution captures the
transient key separately. Historical execution and hydration never fall back
to a later mutable configuration. Native Workspace schema 7 and portable
archive format 6 make this safe request snapshot a strict cutover.

Custom bases accept every syntactically valid absolute HTTP(S) destination
with a host, including public, private, loopback, `localhost`, and
`127.0.0.1`. User information, query strings, and fragments are rejected; the
API-root path is retained and trailing slashes are normalized. Wordflow
deliberately adds no destination allowlist, DNS filter, or private-network
block. Authenticated users are trusted to choose the backend destination, so
operators must accept the resulting SSRF capability. Bounded timeouts, retries,
concurrency, and generic error translation limit execution behavior but do not
remove that network trust decision.

The trade-off is a clean incompatible cutover: credential schema 1, browser
version 1, Workspace schema 6, and archive format 5 have no runtime migration
reader. Required local data must be converted operationally before launch, and
hosted users whose browser partitions were not converted re-add providers.
