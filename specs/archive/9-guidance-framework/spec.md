# Guidance framework and preference boundaries

GitHub issue: https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/9
Status: completed locally on 2026-07-18

## Problem

The frontend implements contextual guidance with its own condition language,
polling scheduler, DOM lookup, positioning, overlay, highlight, and persistence
stack. That behavior duplicates mature tour-library concerns and mixes the
account-level enablement choice with device-local dismissal history. The
backend's in-progress credential resource also writes secrets to the ordinary
preferences filename.

## Desired behavior

- React Joyride v3 owns guidance positioning, overlay, focus, keyboard, and
  accessibility behavior.
- The production contextual-hint and guided-tour registries are empty in this
  release. Existing written tutorials and help icons remain available.
- A Contextual Hint is requested explicitly after a successful user action. It
  has one versioned message and a single `Got it` action. Acknowledgment is
  device-local and scoped by authenticated user, hint ID, and highest seen
  version.
- A Guided Tour is deliberately started, replayable, and uses Back, Next, Done,
  and Skip. Guided Tours do not depend on contextual-hint enablement.
- Only one guidance session may run at a time. Concurrent requests are ignored.
- Missing targets time out without acknowledgment. A target requested while an
  app modal is open waits until that modal closes before its target timeout
  starts.
- App modals remain visually above guidance. Guidance stays rendered underneath
  an open modal but becomes inert and hidden from assistive technology; it
  resumes when the modal closes.
- Contextual guidance cannot be dismissed with Escape or the overlay and blocks
  target interaction. Turning contextual hints off ends an active hint without
  acknowledging it.
- `GET /api/preferences` and `PATCH /api/preferences` expose strict account
  preferences: `hidden_views`, `favorite_workspaces`,
  `default_tokenizer_model`, `analysis_multi_tab_enabled`, and
  `contextual_hints_enabled`.
- TanStack Query is the frontend authority for account preferences. Mutations
  update optimistically, roll back on failure, and show a visible error.
- Device-only state, including the last selected Workspace and guidance
  acknowledgments, remains local.
- Provider credentials remain write-only through
  `/api/provider-credentials` and persist in `provider-credentials.toml`.
- Preference and credential files use only their current strict schemas.
  Unversioned, linked, malformed, or schema-invalid files fail visibly and are
  never silently interpreted or replaced.
- The sidebar entry previously labelled Tutorial is labelled Help. It always
  opens written help; tour launchers render only when a tour registry is
  non-empty.

## Acceptance criteria

- No production custom hint condition scheduler, polling loop, geometry
  renderer, overlay, highlight ring, or shipped hint definitions remain.
- The backend preference and credential resources are user-isolated,
  strict-schema, atomic, symlink-safe, and secret-free on read surfaces.
- Storage coverage includes defaults, strict schema enforcement, Data Portal
  and built-in AI credential updates, corrupt files, user isolation, and secret
  absence from preferences.
- Frontend tests cover account preference query/mutation behavior, versioned
  acknowledgment/reset, empty registries, single-session behavior, missing
  targets, contextual enablement, deliberate tours, and modal
  layering/accessibility.
- OpenAPI and the generated frontend client agree with the backend.
- User and engineering documentation describe the resulting behavior and
  ownership boundaries.

## Non-goals

- Shipping a production Guided Tour or Contextual Hint.
- A condition DSL, global action event bus, scheduler, analytics pipeline, or
  cross-device acknowledgment synchronization.
- Restoring arbitrary custom AI provider URLs.
- Changing workflow-specific draft or presentation preferences.
