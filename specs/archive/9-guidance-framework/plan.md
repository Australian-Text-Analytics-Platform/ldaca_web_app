# Implementation plan

Completed locally on 2026-07-18.

## Boundaries

1. Add a lifespan-owned user-preference store and strict preference API.
2. Split provider credentials to their own strict path under one per-user lock.
3. Regenerate OpenAPI and move frontend account-preference consumers to
   TanStack Query while retaining only device state in Zustand.
4. Replace the custom hint feature with a small Joyride adapter, device-local
   acknowledgment store, request API, and shared modal-layer registry.
5. Rename Tutorial to Help and update Settings plus user documentation.
6. Update the glossary, frontend/backend architecture, API/storage reference,
   and ADR.

## Storage sequence

For one user under one lock:

1. Validate any existing canonical `preferences.toml` and
   `provider-credentials.toml`.
2. Create schema-versioned default preferences when no preference file exists.
3. Reject unversioned, linked, malformed, or schema-invalid storage.
4. Write preference and credential updates atomically to their dedicated files.

Secrets are never returned by preference reads, included in sanitized
preferences, or logged.

## Risks and controls

- Joyride and Radix both manage focus. A shared modal count makes the guidance
  portal inert and toggles Joyride's focus trap reactively while retaining the
  active session.
- Empty production registries can hide dead framework code from normal user
  flows. Tests inject definitions through the public provider boundary.

## Verification

- Backend: focused preference/credential/API tests, OpenAPI export,
  Ruff, ty, full pytest.
- Frontend: focused preference/guidance/Settings/Help tests, generated-client
  tests, lint, full Vitest, build, docs checks.
- Repository: documentation links and `git diff --check` in both repositories.
