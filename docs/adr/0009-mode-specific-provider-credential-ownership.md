---
status: accepted
---

# Make provider credential ownership deployment-mode specific

Provider Credentials have a different trust and persistence boundary from
User Preferences, Workspace content, Analysis state, and User File Import
history. Keeping personal hosted credentials in backend user storage would
make the service their at-rest custodian, while storing local credentials in a
browser would make a single-user installation depend on one browser profile.

Single-user mode therefore has one canonical process identity, `root` / `Root
User` / `root@localhost`. Its provider secrets use the dedicated write-only
`users/root/provider-credentials.toml` resource. They never enter ordinary
User Preferences. Request-supplied secrets are rejected in this mode, and a
configured deployment Data Portal token remains the fallback.

Multi-user personal credentials are owned by the authenticated user's browser.
The frontend stores version 1 data under `wordflow-provider-credentials`,
partitioned by user ID, and injects a secret only inside the final provider API
call. The backend may use that supplied secret for the current operation but
does not persist or cache it. Annotation requires a supplied key; Data Portal
operations prefer a supplied token and otherwise use the deployment token.
Backend credential writes are denied in multi-user mode, and status responses
report browser ownership without claiming to know personal-secret presence.

Submission schemas may contain write-only credential fields, but services
convert them to secret-free Analysis and User File Import requests before
retention. Logs, errors, query keys, mutation variables, Tabs, hydration state,
and public resources likewise exclude secrets.

This is a clean cutover. Existing multi-user credential files remain untouched
but unread so operators can remove them deliberately; users re-enter keys in
their browser. No non-`root` single-user data is migrated. Browser storage
removes server-at-rest custody but does not defend against XSS or privileged
browser extensions, so hosted CSP and XSS hardening remain separate work.
