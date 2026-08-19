# Implementation Plan

1. Add Top-N membership semantics, complete N-independent projection bases,
   bounded single-flight caching, and focused backend tests.
2. Extend Result, Tab, publication, provenance, Workspace, and archive
   contracts; regenerate OpenAPI and the TypeScript client.
3. Generalize the frontend projection lifecycle to K/N attempts while keeping
   graph layout identity K-only, and add the Result control and interaction
   retention tests.
4. Update the ADR, domain, architecture, API/settings references, user
   guidance, export description, and publication mirror.
5. Run package and repository gates, then complete live browser acceptance with
   the Issue #61 corpus.
