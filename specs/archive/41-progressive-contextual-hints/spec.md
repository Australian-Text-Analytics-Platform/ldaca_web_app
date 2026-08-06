# Progressive contextual hints

Issue: [#41](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/41)

## Accepted contract

All nine sidebar functions publish ordered, task-relevant Contextual Hint
milestones. The guidance provider shows the earliest eligible unacknowledged
version within a function visit. Analysis Tab switches remain in the same
visit; changing the sidebar function ends it.

**Got it** and Enter acknowledge and advance. **Not now**, Escape, and a missing
target pause the visit without acknowledgment. Successful event-only milestones
remain eligible across function revisits for the current frontend session.

Definitions, versions, copy, targets, and per-view ordering are centralized.
React Joyride remains the only overlay engine and owns positioning, focus,
scrolling, overlay, and collision behavior. No backend or analytics contract is
changed.

## Scope

- 50 independently versioned hints across Data Loader, Preprocessing, Token
  Frequency, Concordance, Trends and Sequence, Topic Modelling, Quotation,
  Annotation, and Export.
- Compact semantic anchors on shared input/action/result surfaces and
  feature-specific controls.
- Annotation information and tutorial coverage.
- Visit-reducer, provider, registry, anchor, and feature milestone tests.
