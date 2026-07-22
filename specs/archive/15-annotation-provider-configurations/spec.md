# Multi-instance Annotation provider configurations

Status: completed 2026-07-23
Issue: [#15](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/15)

## Objective

Let one user keep multiple named configurations for the same Annotation
provider and select the exact configuration used by each Analysis without
moving secret ownership into Workspace state.

## Contract

- An **Annotation Provider Configuration** has an opaque UUID, an ordered and
  duplicate-allowed display name, a provider type, an optional normalized
  Custom base URL, and one write-only credential.
- Built-in configurations require a key. Custom OpenAI-compatible
  configurations may be keyless.
- Configuration identity is `(provider type, key)` for built-ins and
  `(normalized base URL, key-or-absent)` for Custom. Duplicate identities are
  rejected; duplicate names are allowed.
- Provider type, locator, and credential are immutable. A display name may be
  changed; key rotation or URL changes use add-new-then-delete-old.
- Single-user configurations are stored in strict backend credential schema 2.
  Multi-user configurations remain per-user browser state in localStorage
  schema 2 and inject secrets only into the final request.
- Immutable Annotation Analyses retain the configuration UUID, provider type,
  normalized Custom base URL, and model. They never retain the configuration
  name or credential.
- Custom providers accept any absolute HTTP or HTTPS destination with a host,
  including private and loopback destinations. Userinfo, query strings, and
  fragments are invalid. The API-root path is retained and trailing slashes
  are normalized.
- The Annotation selector shows configured entries only and ends with an
  **Add Provider** action. Settings uses the same add dialog and supports
  rename, delete, and clear-all.
- A missing selected configuration falls back to the first remaining
  configuration of the same provider type. With no same-type configuration it
  clears; historical Results remain readable.
- Workspace schema 7, archive format 6, credential-file schema 2, and browser
  credential schema 2 are strict cutovers with no runtime migration readers.

## Acceptance criteria

- Backend API, service, persistence, execution, and serialization tests prove
  the collection contract, mode ownership, secret stripping, custom provider
  behavior, and version rejection.
- Frontend store, facade, tab, dialog, selector, Settings, and request tests
  prove ordered multi-instance behavior, account isolation, safe caching, and
  deletion fallback.
- OpenAPI and the generated frontend SDK match the backend source.
- Current documentation, glossary, ADR 0013, and exact inventories describe
  the resulting contract.
- Required local data is manually converted before browser acceptance, without
  a committed converter or runtime migration.
- Full backend, frontend, documentation, diff, and browser acceptance gates
  pass.

## Non-goals

- Server-side persistence of multi-user personal provider credentials.
- Compatibility readers or automatic migration for old credential, Workspace,
  or archive formats.
- Destination allowlisting, DNS/IP filtering, or private-network blocking for
  trusted custom-provider requests.
- Persisting configuration names or secrets in portable Workspace state.
