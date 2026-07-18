---
status: accepted
---

# Separate account preferences, guidance history, and credentials

Wordflow stores synchronized non-secret User Preferences in the backend,
versioned Contextual Hint acknowledgment history per user on each device, and
provider secrets behind a separate write-only backend resource. These three
lifecycles differ: preferences should follow an account, acknowledgments are
local interaction history, and secrets must never travel through an ordinary
preference read.

The frontend therefore uses TanStack Query as the sole User Preferences
authority and local storage only for `user ID -> hint ID -> highest version`.
The backend persists `preferences.toml` separately from
`provider-credentials.toml` and rejects earlier mixed or unversioned layouts.
Cross-device hint synchronization, a global hint condition scheduler, and
returning secret values from either read resource are deliberately excluded.
