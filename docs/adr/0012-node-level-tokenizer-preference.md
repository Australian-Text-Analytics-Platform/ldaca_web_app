---
status: accepted
---

# Separate Data Block tokenizer preferences from Analysis and cache state

Tokenizer selection previously had three competing-looking representations:
per-column Data Block tokenization metadata, an account-wide default, and
model mappings retained on some Analysis requests. Cached token columns added
a fourth state whose lifecycle could be mistaken for durable metadata. A
column edit could therefore appear to change execution semantics, while a
historical Analysis could accidentally consult a mutable current default.

Wordflow separates these concerns into three authorities:

- A Data Block may own one optional scalar Tokenizer Preference. It is opaque,
  independent of the Document Column Preference, and used only to initialize
  a fresh control that exposes tokenizer selection. It survives save/reopen and
  archive round trips already owned by that Data Block, but is never inherited
  by a Derived Data Block, clone, or Analysis detachment.
- A submitted Analysis owns its exact document-column and tokenizer-model
  mappings, plus Concordance search mode. Token Frequency requires a model for
  every selected Data Block. Concordance Text mode retains any selections but
  does not tokenize, while Tokens mode requires every selection. Execution and
  every later projection use only the immutable request and retained input.
- Tokenized content is per-user cache state addressed by model, tokenization
  parameters, and text content hash. It is neither Workspace metadata nor an
  Analysis parameter. The native plain-word model bypasses DuckDB entirely.

Document and tokenizer controls persist through independent partial Data Block
updates. There is no account-wide tokenizer default and no per-column
tokenization registry. Native Workspace schema 6, portable archive format 5,
and `preferences.toml` schema 2 establish one current persisted contract;
earlier versions are rejected rather than migrated at runtime.

This keeps selector convenience, reproducible Analysis execution, and
discardable computation cache distinct. It also means catalogue changes do
not corrupt Workspaces because stored model IDs are bounded opaque strings.
The trade-off is that operators must perform any one-off preference-file
cutover before starting the new version, and older Workspaces or archives must
be recreated or converted out of band.

This ADR supersedes only the tokenization-metadata reconciliation clause of
[ADR 0007](0007-data-block-edits-and-session-history.md). Its decisions about
Data Block edits, provenance, and process-local Undo/Redo remain in force.
