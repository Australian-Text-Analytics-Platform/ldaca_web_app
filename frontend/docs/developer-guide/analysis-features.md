# Analysis Feature Patterns

Analysis tabs share the same high-level lifecycle: lock a valid node selection,
submit or hydrate a request, follow task status through SSE, and refresh result
data only after terminal task events.

## Shared Lifecycle

`features/analysis/common/hooks/useAnalysisFeature.ts` is the generic analysis
state machine. It handles:

- local task id state,
- running/locked state,
- current request/result hydration from backend endpoints,
- terminal result fetch,
- clear/reset behavior,
- cancelling the current backend task from the owning tab,
- request hydration.

`features/analysis/common/tasks/useAnalysisTaskFlow.ts` connects an analysis
tab to the task stream. It refreshes results only when the relevant task reaches
a terminal state and the tab is active.

Use the shared analysis card Stop and Clear Results actions for task lifecycle
controls. The sidebar Task Center should not own cancellation or clearing;
feature tabs know which task ids and descendants the backend should resolve.

## Selection And Colors

Analysis tabs use the current workspace selection but apply feature-specific
caps:

- token frequency, concordance, and topic modeling allow one or two document
  nodes;
- sequential analysis, quotation, and AI annotation use one node;
- preprocessing and export have separate active-node rules.

`useNodeColorManagement` coordinates per-tab temp colors and committed node
colors. A successful run promotes participating temp colors to assigned colors.

## Token Frequency

Token frequency submits worker jobs, supports one-corpus or two-corpus
comparison, applies stop words and token limits, and exports result tables.
Pairwise keyness treats the second selected node as the study corpus and the
first as the reference corpus.

Each selected node card renders a tokenizer model selector next to the text
column selector. Selecting a document column persists `Node.document` through
`PUT /workspaces/nodes/{node_id}/document-column`; other document-oriented
analysis selectors use the same endpoint instead of mutating node metadata in
their submit routes. The tokenizer selector samples the first page of the
selected column via `GET /workspaces/nodes/{node_id}/data`, runs MediaPipe
Language Detector in the browser, normalizes the result to ISO 639-1, and fetches
the backend tokenizer inventory from `GET /workspaces/tokenizer-models` when the
dropdown opens. Models whose backend-provided `languages` include the detected
code are rendered first in a recommended group. Choosing a model calls
`PUT /workspaces/nodes/{node_id}/tokenization-preference`, so token frequency
requests rely on `Node.tokenization` metadata rather than sending frontend-owned
model maps. Choosing the placeholder model clears that column's tokenization
preference; choosing the placeholder column clears `Node.document`. Default
stop-word filling is client-side: saved ISO 639-1 language metadata is converted
to ISO 639-3 before reading the matching `stopword` package list.

## Concordance

Concordance supports regex and token modes, metadata columns, table and
dispersion views, bin selection, detach, dispersion detach, and materialized
result paging. It can receive a pending handoff from token frequency.

## Quotation

Quotation runs local or remote quote extraction depending on the user's
preference. The tab manages engine configuration, grouped quote rows, metadata
columns, result materialization, and detach.

## Topic Modeling

Topic modeling submits BERTopic/embedding work through backend workers. The UI
handles exact/min topic size modes, sampling per corpus, random seed,
representative words, stop-word display filtering, embedding cache state, and
chart interactions.

## Sequential Analysis

Sequential analysis runs trend grouping over one node. It supports datetime,
integer, and float time columns, frequency/custom intervals, chart export, and
selected-period detach.

## AI Annotation

AI annotation calls backend OpenAI classification endpoints, manages providers
and categories, and can detach saved labels into a workspace node.

## Adding A New Analysis Tab

Start from the shared common hooks and generated backend SDK/types. Add backend
schema models first when a generated response would otherwise become `unknown`.
Keep task refresh event-driven, and expose detach or materialize flows only
through workspace actions so graph invalidation remains centralized.
