# Domain Documents

Engineering skills should read the domain documents relevant to their task
before proposing names, tests, or architecture.

## Canonical Sources

- `CONTEXT.md` is the single Wordflow glossary. Use its preferred terms and do
  not drift to synonyms it explicitly avoids.
- `docs/domain/` contains durable product invariants and lifecycle semantics.
- `docs/adr/` contains accepted decisions. Surface a conflict with an ADR
  explicitly instead of silently overriding it.

If a concept is absent, proceed with code exploration. Add a glossary term only
when domain-modeling work resolves a genuinely Wordflow-specific concept.
General programming terminology and implementation details do not belong in
`CONTEXT.md`.

Wordflow is one domain context. Technical package boundaries such as frontend,
backend, and `polars-text` live in architecture documentation rather than in a
`CONTEXT-MAP.md`.
