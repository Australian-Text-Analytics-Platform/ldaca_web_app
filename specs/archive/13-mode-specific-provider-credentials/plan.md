# Implementation plan

1. Fix the single-user identity and separate credential file I/O from User
   Preferences.
2. Make backend credential resolution mode-aware, add transient secret-bearing
   submission contracts, and prove persisted state is secret-free.
3. Regenerate OpenAPI and add the per-user Zustand credential store, frontend
   facade, Settings behavior, and request-boundary secret injection.
4. Update the glossary, ADRs, architecture, domain, API/settings references,
   deployment runbook, and user documentation.
5. Run complete backend, frontend, OpenAPI, documentation, diff, and live
   single-/multi-user acceptance checks, then archive the change record.
