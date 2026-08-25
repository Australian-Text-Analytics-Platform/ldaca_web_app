---
status: accepted
---

# Pinned VS Code 2026 Theme Runtime

## Context

Wordflow previously mixed shadcn-era semantic variables, Tailwind palettes,
feature-local styling, and a `.dark` compatibility path. That made theme
ownership ambiguous and allowed components and third-party integrations to
drift independently. Issue #81 requires one modern, compact UI system with an
account-synchronized Light and Dark choice.

## Decision

Wordflow supports exactly `light-2026` and `dark-2026`. Their resolved colors
and design metrics are normalized in one manifest pinned to Visual Studio Code
1.134.0 commit `474a349ad5b745e512ef86b864d1c74f7264dd7a`, including the bundled Light
2026, Dark 2026, design-token guidance, button geometry, and Modern UI source.
An offline deterministic generator emits the CSS variables and Tailwind v4
mappings, and build checks reject stale output or legacy presentation styling.

Before React loads, a synchronous script applies the last-known
`ldaca-color-theme-v1` value or Light when storage is missing, invalid, or
unavailable. The React theme service owns root application, change events, and
the `useSyncExternalStore` integration. TanStack Query remains authoritative:
the cached value prevents a flash, but a successfully loaded account
preference replaces it. Settings applies changes optimistically, persists them
immediately, and restores the DOM, cache, and query state when persistence
fails.

The live interface consumes only the generated VS Code semantic vocabulary.
Primary surfaces are flat and bordered; elevation is reserved for floating
overlays. Persisted Data Block and series colors remain theme-independent.
Chart and image exports always use a white canvas and stable export palette.
Brand and provider assets are explicit raw-color exceptions.

## Consequences

- There is no system, custom, high-contrast, `.dark`, legacy-token, or
  feature-flag theme path.
- Existing version-2 preference files remain valid because `color_theme`
  defaults to `light-2026`; the schema version does not change.
- Upstream values remain frozen until an explicit pinned-snapshot upgrade.
- Shared primitives and third-party adapters use the same compact metrics and
  semantic variables, while export appearance does not depend on the active
  live theme.
