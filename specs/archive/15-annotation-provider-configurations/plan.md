# Implementation plan

1. Replace fixed backend credential slots with strict configuration value
   contracts, schema-2 atomic storage, and single-user CRUD resources.
2. Carry safe configuration identity through discovery, preview, immutable
   Annotation requests, workers, Workspace schema 7, and archive format 6 while
   carrying the credential separately in memory.
3. Regenerate OpenAPI and the frontend client, then replace the version-1
   browser slots and credential facade with ordered configuration collections.
4. Build the shared Add Provider dialog, configured-only selector, Settings
   management, per-configuration model state, and deletion/hydration fallback.
5. Update the glossary, ADR 0013, architecture/domain/reference/user docs, and
   exact version inventories.
6. Manually convert only the current in-scope local credential and Workspace
   data, run all automated gates, perform browser acceptance, archive this
   specification, and close issue #15 with evidence.

## Risks and controls

- **Secret leakage:** keep keys out of response models, Query mutation state,
  Analysis requests, logs, and cache keys; test serialized resources directly.
- **Custom destination access:** retain existing bounded timeouts, retries,
  concurrency, and generic error translation; record the deliberate trusted-
  user SSRF trade-off in ADR 0013.
- **Strict format cutover:** reject old versions explicitly and manually convert
  required live data before restart rather than adding compatibility branches.
- **Dirty worktree overlap:** preserve the accepted Annotation cache fix,
  graph-shape work, tokenizer changes, and unrelated preprocessing edits.
