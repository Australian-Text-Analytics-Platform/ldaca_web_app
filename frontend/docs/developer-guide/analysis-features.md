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
- request snapshots.

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
integer, and float time columns, frequency/custom intervals, chart export,
selected-period detach, and snapshot capture at configurable granularity.

## AI Annotation

AI annotation calls backend OpenAI classification endpoints, manages providers
and categories, and can detach saved labels into a workspace node.

## Adding A New Analysis Tab

Start from the shared common hooks. Add feature-specific API wrappers under
`src/api/text/`, keep task refresh event-driven, and expose detach or
materialize flows only through workspace actions so graph invalidation remains
centralized.
