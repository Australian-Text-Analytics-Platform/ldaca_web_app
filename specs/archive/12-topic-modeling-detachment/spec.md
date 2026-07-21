# Topic Modeling detachment with multi-output Analyses

Issue: [#12](https://github.com/Australian-Text-Analytics-Platform/ldaca-wordflow/issues/12)

## Objective

Restore Topic Modeling detachment as a typed child Analysis and make Analysis
output identity accurately represent operations that atomically publish more
than one Data Block.

## Contract

- Replace `output_node_id` with required `output_node_ids: list[UUID]` throughout
  domain records, Result resources, service publications, OpenAPI, and frontend
  consumers.
- This is a clean break. Records using the removed singular field or omitting
  the required list are invalid; there is no migration, alias, or fallback.
- The list is unique and ordered. Non-publishing Analyses store an empty list.
- Existing Annotation, Concordance, and Quotation publications return a
  one-element list.
- A Topic Modeling detachment is a child of one successful Topic Modeling root.
  It may detach one or more of the parent's declared input Data Blocks.
- For each requested source, the child publishes a topic-data Data Block and a
  topic-meanings Data Block. Output IDs are ordered by request order and then as
  topic data followed by topic meanings.
- The typed Topic Modeling Result also records each semantic triple:
  source, topic data output, and topic meanings output.
- Publication is atomic under the Workspace mutation gate: all Data Blocks and
  the successful child Analysis commit together, or none do.
- Topic data is parented by its source Data Block. Topic meanings is parented by
  the corresponding topic-data Data Block.

## User experience

The Topic Modeling Results panel exposes an **Add to Workspace** action. The
dialog lets the user choose sources, columns, topic subset, and output names.
Completion refreshes the Workspace graph and Data Block resources without
changing or clearing the root Analysis Result.

## Non-goals

- No restoration of the removed standalone Topic Modeling detachment endpoint.
- No compatibility with `output_node_id` or older serialized Analysis records.
- No generic untyped Analysis-to-Data-Block publication endpoint.
- No in-place mutation of source Data Blocks.
