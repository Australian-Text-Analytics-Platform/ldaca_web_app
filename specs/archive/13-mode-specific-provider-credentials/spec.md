# Mode-specific provider credentials and fixed local identity

Status: completed
Completed: 2026-07-21
Issue: [#13](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/13)

## Objective

Give each deployment mode one explicit credential owner while making local
execution use one canonical process identity.

## Contract

- Single-user mode has exactly one identity: `root`, `Root User`, and
  `root@localhost`. Startup provisions that user, and local identity is not
  configurable.
- Single-user provider credentials are write-only secrets stored only in
  `users/root/provider-credentials.toml`. They are not User Preferences,
  Workspace state, or Analysis state.
- Multi-user personal provider credentials are stored only in browser
  `localStorage`, partitioned by authenticated user. Backend calls receive them
  transiently and never persist or cache them.
- Annotation calls require a personal key. Data Portal calls use a supplied
  personal token when present and otherwise use the deployment token.
- Request secrets are removed before Analysis or User File Import state is
  retained. They do not enter cache keys, mutation variables, Tabs, hydrated
  requests, resources, logs, errors, or telemetry.
- Credential status is safe to read in both modes. Credential mutations are
  available only in single-user mode; multi-user mutation attempts are denied.
- This is a clean API cutover. Annotation model discovery and Data Portal
  featured discovery become POST operations with write-only request secrets;
  preview, Analysis submission, search, and import gain corresponding
  write-only request fields.

## Browser persistence

The multi-user store uses the key `wordflow-provider-credentials`, schema
version 1. It stores OpenAI, OpenRouter, Anthropic, Google, and Data Portal
credentials per authenticated user, retains them over logout, synchronizes
replacement and deletion across tabs, and exposes only presence metadata to UI
components.

## Cutover

Existing multi-user credential files remain untouched but become unread.
Operators may remove them manually and users must re-enter personal keys in
their browser. Existing non-`root` single-user data is not migrated because
custom local identity is assumed not to be deployed.

## Non-goals

- No server-side multi-user credential fallback or compatibility method.
- No automatic cleanup of legacy multi-user credential files.
- No migration of data from a configured non-`root` single-user identity.
- No hosted CSP or XSS hardening in this change.
