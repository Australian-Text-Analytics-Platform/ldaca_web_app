# Analysis Feature Patterns

Analysis tabs share the same high-level lifecycle: own an input-node set, submit
or hydrate a request, follow task status through SSE, and refresh request/result
data from the tab-owned task id.

## Tab-Owned State

Tabbed analysis views are hosted by
`src/features/views/common/tabs/AnalysisTabsHost.tsx`. The host loads the
workspace's `tabs.json` sidecar through `useWorkspaceTabs` before rendering the
active feature. Each persisted tab owns:

- `tab_id`: the UI identity and React key for that tab;
- `task_id`: the optional backend task/result the tab currently shows;
- `title`: the tab label;
- `inputs`: the add-as-needed node inputs, each with `node_id` and optional
  `column`.

When a tab becomes active, the host passes `tabTaskId` and `tabInputs` into the
feature. The feature must pass `tabTaskId` to `useAnalysisFeature` as
`hydrationTaskId` and provide both `fetchRequest(taskId, headers)` and
`fetchResult(taskId, headers)`. Hydration then resolves the tab-owned task id,
fetches the saved request first, applies feature parameters from that request,
and fetches the result for the same task id. New runs report their assigned task
id through `onTabTaskChange`, which persists it back to `tabs.json`. The
`hydrationTaskId` change itself is a hydration trigger: after a run assigns a
new task id, the feature fetches both request and result for that id instead of
waiting solely for a task-stream terminal event. Clear Results clears the same
tab field with `null`.

Do not hydrate analysis panels from the current graph selection, a global
current-task endpoint, or a sibling tab's task id. The shared lifecycle resolves
request/result hydration from explicit task-id candidates only.

Backend analysis tasks are independent records. Running a second tab must never
overwrite, delete, or hide the first tab's task; each tab stores the task id it
owns. Submit endpoints do not accept frontend `tab_id`; tab identity is UI
sidecar state and backend analysis data is stored under the returned task id.

The user preference `analysisMultiTabEnabled` controls whether the Chrome-style
tab strip is visible. When it is disabled, a workspace-level cleanup collapses
every persisted analysis group in the current workspace to its first tab,
persists the updated sidecar, and clears backend tasks owned by the removed
tabs. `SettingsDialog` checks the current workspace sidecar first and shows a
destructive confirmation only when extra tabs would actually be removed. The
host still loads or creates one tab, passes that `tab_id` to the feature, and
persists tab-owned task and input state when the controls are hidden.

## Shared Lifecycle

`features/views/common/hooks/useAnalysisFeature.ts` is the generic analysis
state machine. It handles:

- local task id state,
- running and terminal-task state,
- tab-task request/result hydration from backend endpoints,
- terminal result fetch,
- clear/reset behavior,
- cancelling the current backend task from the owning tab,
- request hydration.

`features/views/common/tasks/useAnalysisTaskFlow.ts` connects an analysis
tab to the task stream. It refreshes results only when the relevant task reaches
a terminal state and the tab is active.

Use the shared analysis card Stop and Clear Results actions for task lifecycle
controls. The sidebar Task Center should not own cancellation or clearing;
feature tabs know which task ids and descendants the backend should resolve.

## Node Inputs And Visualization Colours

Analysis tabs use the add-node-as-needed model. `NodeInputsPanel` is the shared
UI for selecting data blocks, selecting the per-node column when a feature needs
one, adding graph/recent presets, removing nodes, and clearing a tab's inputs.
`useTabNodeInputs` binds the panel to a tab's persisted `inputs` and live
workspace node metadata. `nodeInputsFromSelections` is the shared adapter for
hydration and handoff paths that receive `{nodeId, column}` selections and need
to persist `AnalysisTabInput` records. The current graph selection is only a
source for "Add preset" or graph-node add buttons; it is not the analysis input
state.

Feature-specific caps are enforced through `NodeInputConstraints`:

- token frequency, concordance, and topic modeling allow one or two document
  nodes;
- sequential analysis, quotation, and AI annotation use one node;
- preprocessing stores per-subtab inputs in `preprocessingInputsStore` and
  renders the same `NodeInputsPanel` inside each subtab parameter card;
- export remains graph-selection based because it acts on workspace nodes rather
  than an analysis tab.

Analysis visualizations derive source colours locally from
`views/common/vizPalette.ts`. There is no shared node-colour store or picker:
selected source nodes receive deterministic palette colours by position for
charts, tables, legends, and metadata selectors.

## Token Frequency

Token frequency submits worker jobs, supports one-corpus or two-corpus
comparison, applies stop words and token limits, and exports result tables.
Pairwise keyness treats the second selected node as the study corpus and the
first as the reference corpus. Token-frequency utilities own node-id ordering,
study-corpus ordering, and display-name fallbacks so task submission, result
display, and concordance handoffs reuse the same normalization rules.
`useTokenFrequencyResultModel` owns result display-name recovery, analysis-node
ordering, normalized row models, stop-word/token-limit projections, and download
dialog refs so `TokenFrequencyFeature` can stay focused on task lifecycle,
selection, and panel composition.
`tokenFrequencyStopWords.ts` owns editable stop-word parsing, de-duplication,
formatting, and default-list merging for the preferences hook. Shared tokenizer
preference helpers in `views/common/` merge backend-persisted tokenizer models
with live per-tab overrides for token frequency and concordance.
`hooks/tokenFrequencyPreferenceState.ts` owns the reducer state for editable
stop-word text, the applied stop-word set, token-limit input/error state, and
preference persistence busy flags; keep those transitions there instead of
adding independent `useState` cells to `useTokenFrequencyPreferences`.
`hooks/useTokenFrequencyListLimit.ts` owns the result-panel list/cloud display
limit synchronization: list limits may exceed the cloud cap of 100, but list
applies mirror a capped backend value and cloud applies mirror back into list
state.

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
result paging. `useConcordanceParameters` owns the search form model, saved
request hydration, and rerun-diff normalization on top of
`concordanceParameterState.ts`, which keeps the regex/whole-word invariant in a
pure reducer. `useConcordanceTokenizerMode` owns regex/token-mode selection,
token-mode availability, and live tokenizer model overrides.
`useConcordanceResultControls` owns per-node pagination, loading flags,
materialize progress, page-size hydration, and materialize summary parsing
through one reducer-backed state model that still exposes Dispatch-compatible
setters to the task-flow and materialization-event hooks.
`concordanceViewModels.ts` owns pure result shaping for combined slices,
dispersion rows/bins, materialized block lookup, server-bin tagging, and
matched-text/source colour models. `useConcordanceResultViewModel` owns
client-side materialized path/bin cache state, fetches missing server bins for
whole-corpus dispersion charts, and exposes the label, colour, and lookup maps
used by metadata and result panels. `concordanceTableModel.ts` and
`concordanceDispersionTableModel.ts` own the table row/column models so
combined and per-node result blocks share KWIC alignment, metadata filtering,
and dispersion metadata-boundary behavior. `concordanceDispersionActions.ts`
owns the shared dispersion Add-to-Workspace disabled/title model, matched-term
legend filtering, and immutable hidden-term toggling for combined and per-node
dispersion blocks. `useConcordanceRowDetail` owns the row-click payload and
Concordance-specific RowDetailPanel summary/highlight customization.
`concordanceDetachDialogState.ts` owns the atomic payload state for per-hit and
dispersion detach dialogs so open flags, pending nodes, loaded options, and
dispersion filters reset together.
Concordance can receive a pending handoff from token frequency.

## Quotation

Quotation runs built-in or remote quote extraction depending on the tab's engine
setting. `useQuotationEngineSettings` owns local/remote engine state, URL
normalization, and request validation; `useQuotationContextPreference` owns the
context-length input and persisted preference. `useQuotationResultControls`
owns grouped-row normalization, node pagination state, materialized paths,
materialize summaries, async materialize/detach progress maps, and clear reset
through one reducer-backed result model. `useQuotationDetachDialog` owns
detach-option loading and source-column checklist state so the feature shell
does not carry dialog-specific pending-node state inline. `useQuotationRowDetail`
owns the result-row detail payload, generated-column exclusions, and
Quotation-specific RowDetailPanel summary/highlight customization.
`useQuotationMaterializeLifecycle` watches background materialize tasks, refreshes
the parent task request for materialized path/summary metadata, and resets the
result page size after processing. `quotationResultsModel.ts` owns result
metadata availability, selected-column filtering, display-column ordering, and
quote-row filtering. `components/QuotationResultsPanel.tsx` owns the rendered
results card, metadata selector, context-length control, and per-node result
table wiring; keep task lifecycle and request hydration in `QuotationFeature`.
The tab still owns metadata-column visibility state.

## Topic Modeling

Topic modeling submits BERTopic/embedding work through backend workers. The UI
handles minimum topic size, sampling per corpus, random seed, representative
words, and chart interactions. `useTopicModelingParameters` owns the run
parameter model so request hydration, clear behavior, sampling warnings, and
`sample_fractions` diffing stay aligned. Its scalar value/user-set pairs and
sampling defaults are backed by `topicModelingParameterState.ts`, keeping
hydration and Clear Results transitions testable without rendering the feature.
`useTopicModelingResultControls` owns result-panel interaction state: bubble
hover, tooltip payloads, selected topic ids, and the topic search query. Keep
chart/result controls there instead of adding independent state cells to
`TopicModelingFeature`.

## Sequential Analysis

Sequential analysis runs trend grouping over one node. It supports datetime,
integer, and float time columns, frequency/custom intervals, chart export, and
selected-period detach. `useSequentialAnalysisParameters` owns the run
parameter model, hydrated request normalization, group-by slot edits, and
rerun-diff values through one reducer-backed state model so hydration and
Clear Results update related inputs atomically. The feature shell can focus on
task lifecycle, schema locking, and result orchestration.
`useSequentialChartControls` owns legend
visibility, x-axis mode, chart export dialog state, selected periods, and
detach naming. `sequentialChartModel.ts` owns chart types, palette fallback, and
time-label formatting so chart presentation concerns do not live in the task
submission hook. `sequentialChartExport.ts` owns the downloaded chart header and
legend metadata. `sequentialResultVisibility.ts` owns hidden-series and
selected-period count derivation so the result panel and chart export header use
the same shown/chosen totals.

## AI Annotation

AI annotation calls backend OpenAI classification endpoints, manages providers
and categories, and can detach saved labels into a workspace node.
`useAiAnnotationSettings` owns provider/model/prompt settings and request
parsing. `useAiAnnotationTaskFlow` owns run, page-load, model-list, clear, and
detach side effects plus their busy flags, while the feature shell keeps the
shared lifecycle status message so hydration and task actions can both report
through one banner. `useAiAnnotationResultControls` owns annotation
result-node normalization, visible-column derivation, paging state, and
metadata-column selection. `useAiAnnotationReviewWorkflow` coordinates review
API side effects on top of a reducer-backed review state model for the loaded
row page, provider/category caches, draft edits, autosave flags, and add
dialogs.

## Adding A New Analysis Tab

Start from `AnalysisTabsHost`, `NodeInputsPanel`/`useTabNodeInputs`, the shared
common hooks, and generated backend SDK/types. Add backend schema models first
when a generated response would otherwise become `unknown`.

The minimum task-backed contract is:

- accept `tabId`, `tabTaskId`, `onTabTaskChange`, `tabInputs`, and
  `onTabInputsChange` from `AnalysisTabFeatureProps`;
- pass `tabTaskId ?? null` as `hydrationTaskId` to `useAnalysisFeature`;
- implement `fetchRequest` and `fetchResult` for the analysis task endpoints;
- call `onTabTaskChange(taskId)` when a run assigns a backend task id;
- call `onTabTaskChange(null)` when Clear Results removes the tab's task;
- use `tabInputs` as the only analysis input state, seeding it from hydrated
  requests only for legacy tabs whose saved task predates persisted inputs.

Keep task refresh event-driven, and expose detach or materialize flows only
through workspace actions so graph invalidation remains centralized.
