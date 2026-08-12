# Annotation Provider Store Usability

Issue: [#34](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/34)

Status: completed 2026-08-13.

## Accepted behavior

- A configuration UUID and its provider locator are stable; its name and
  optional write-only credential are mutable.
- All providers may be saved without a key. Built-ins require one only at use;
  Custom providers may remain keyless.
- Configurations may be identical except for UUID. Persistence stays at schema
  and browser-storage version 2.
- Single-user mutations remain backend-owned and multi-user mutations remain
  browser-owned.
- Settings provides Edit, remove-key, loading, failure, and Retry states.
  Annotation retains incomplete selections, prevents unusable requests, and
  never falls back to another account after deletion.
- Safe provider-error categories drive synchronous failures and durable Run All
  failures. Provider-wide failures publish nothing; only irreducible row-local
  context or response failures publish partial output with an explicit mask and
  durable counts.

## Compatibility boundary

There is no persisted-shape migration. The PATCH operation ID changes from
`rename_annotation_provider_configuration` to
`update_annotation_provider_configuration`, and generated clients must update.

## Non-goals

- Editing provider type or Custom base URL.
- Testing a connection while saving it.
- Editing a provider outside Settings.
- Exposing raw provider or SDK failure details.
