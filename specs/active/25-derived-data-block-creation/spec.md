# Per-Source Add to Workspace Controls and Derived Data Block Creation

Issue: [#25](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/25)

## Accepted behavior

- Add to Workspace presents Select all and Select none independently for every
  included source in Concordance, Quotation, and Topic Modelling.
- Required columns remain selected. Optional columns submit in the stable
  contract order declared by the source Result.
- Source inclusion, names, defaults, and selections remain independent. There
  is no cross-source apply action.
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

- Applying one source's column selection to another source.
- Adding Sequential Analysis output creation.
- Changing atomic storage, import, event, or release terminology.
- Implementing Issue #24's per-topic output controls.
