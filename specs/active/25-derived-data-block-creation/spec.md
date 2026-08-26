# Per-Source Add to Workspace Controls and Derived Data Block Creation

Issue: [#25](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/25)

## Accepted behavior

- Add to Workspace presents Select all and Select none independently for every
  included source in Concordance, Quotation, and Topic Modelling.
- Required columns remain selected. Optional columns submit in the stable
  contract order declared by the source Result.
- Source inclusion, names, and defaults remain independent. Column selections
  remain independent while Sync columns is off. In multi-source dialogs, the
  transient Sync columns toggle applies exact shared optional-column names to
  every checked source while preserving required columns and request order.
- The UI command is Add to Workspace. The domain and analysis API call the
  effect Derived Data Block Creation. Publication remains an infrastructure
  term for making staged state atomically visible.
- Sequential Analysis does not offer Add to Workspace.

## Compatibility boundary

The persisted kinds are `concordance_match_data_block_creation`,
`concordance_document_data_block_creation`,
`quotation_result_data_block_creation`, and
`topic_modeling_data_block_creation`. Native Workspace schema 15 and portable
archive format 14 are a strict cutover with no alias or data migration.

Device-local guidance acknowledgments migrate the three former contextual-hint
IDs to their `*.add-to-workspace` replacements.

## Non-goals

- Persisting synchronized selections outside the open dialog or copying Data
  Block names between sources.
- Adding a separate one-shot Apply to all sources action.
- Adding Sequential Analysis output creation.
- Changing atomic storage, import, event, or release terminology.
- Implementing Issue #24's per-topic output controls.
