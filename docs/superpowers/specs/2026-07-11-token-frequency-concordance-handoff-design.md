# Token Frequency to Concordance Handoff Design

## Goal

Clicking a token in token-frequency results must open a new Concordance tab and immediately run the concordance search. This behavior must be identical whether the `Enable multi-tab` preference is enabled or disabled.

## Multi-tab Preference Contract

`Enable multi-tab` is a presentation preference only. It must not delete tabs, collapse persisted tab groups, clear tab-owned backend tasks, prevent programmatic tab creation, or force the first tab to be active.

For each analysis group:

- When the preference is enabled, show the tab strip and add button for any tab count.
- When the preference is disabled and the group has zero or one tab, hide the tab strip and add button.
- When the preference is disabled and the group has two or more tabs, show the complete multi-tab interface, including the add button.

The Settings switch therefore writes the preference directly. Disabling it is non-destructive and requires no tab-state fetch or confirmation dialog.

## Token Handoff Flow

When a user clicks a token-frequency token:

1. Resolve the source nodes and text-column selections using the completed token-frequency request, with the existing selection fallbacks.
2. Create and activate a new tab in the Concordance tab group, regardless of the multi-tab preference.
3. Switch to the Concordance view.
4. Apply the token, selected nodes, and selected columns to the newly mounted Concordance tab.
5. Submit the Concordance task once the handed-off inputs are available.

The new tab must own the returned Concordance task id. Existing Concordance tabs and their results remain unchanged.

## Reliability

The automatic run must be driven by the applied handoff state, not by an arbitrary delay that assumes React state updates have finished. The Concordance submission must see the handed-off search word, nodes, and columns in the same logical operation. A handoff with insufficient runnable inputs should preserve the populated form without submitting an invalid request.

## Tests

Regression coverage will verify:

- A token click creates a fresh Concordance tab and marks the handoff for immediate execution.
- Concordance submits exactly once with the handed-off token, nodes, and columns.
- Disabled multi-tab hides tab chrome for one tab.
- Disabled multi-tab shows the full tab interface when a second tab is added.
- Disabling multi-tab does not remove persisted tabs or clear their tasks.
- Existing token-frequency source scoping and two-node comparison behavior remain intact.

## Scope

This change is limited to the shared tab presentation/preference flow and the token-frequency-to-Concordance handoff. It does not change backend analysis APIs, tab persistence schemas, or unrelated analysis behavior.
