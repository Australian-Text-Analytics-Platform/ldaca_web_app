# VS Code 2026 Theme and Modern UI Cutover

Issue: [#81](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/81)

Replace the previous styling system atomically with exact Light 2026 and Dark
2026 themes pinned to VS Code 1.134.0 commit
`474a349ad5b745e512ef86b864d1c74f7264dd7a`. Account preferences own the
selection after successful loading; a synchronous local cache prevents startup
flicker. All live surfaces and integrations use the compact Modern UI token
system, while stable data colors and white exports remain independent.

Acceptance requires backend preference compatibility, deterministic generated
tokens, no legacy theme path, optimistic Settings persistence with rollback,
shared primitive and application-surface migration, integration theming,
source audits, runtime tests, package checks, and visual acceptance in both
themes.
