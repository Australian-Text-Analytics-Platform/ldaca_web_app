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

## Node Inputs And Colors

Analysis tabs use the add-node-as-needed model. `NodeInputsPanel` is the shared
UI for selecting data blocks, selecting the per-node column when a feature needs
one, adding graph/recent presets, removing nodes, and clearing a tab's inputs.
`useTabNodeInputs` binds the panel to a tab's persisted `inputs` and live
workspace node metadata. The current graph selection is only a source for
"Add preset" or graph-node add buttons; it is not the analysis input state.

Feature-specific caps are enforced through `NodeInputConstraints`:

- token frequency, concordance, and topic modeling allow one or two document
  nodes;
- sequential analysis, quotation, and AI annotation use one node;
- preprocessing stores per-subtab inputs in `preprocessingInputsStore` and
  renders the same `NodeInputsPanel` inside each subtab parameter card;
- export remains graph-selection based because it acts on workspace nodes rather
  than an analysis tab.

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

Quotation runs built-in or remote quote extraction depending on the user's
preference. The parameter panel owns the engine radio controls and conditional
remote endpoint input; the tab also manages grouped quote rows, metadata columns,
result materialization, and detach.

## Topic Modeling

Topic modeling submits BERTopic/embedding work through backend workers. The UI
handles exact/min topic size modes, sampling per corpus, random seed,
representative words, stop-word display filtering, and chart interactions.

## Sequential Analysis

Sequential analysis runs trend grouping over one node. It supports datetime,
integer, and float time columns, frequency/custom intervals, chart export, and
selected-period detach.

## AI Annotation

AI annotation calls backend OpenAI classification endpoints, manages providers
and categories, and can detach saved labels into a workspace node.

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
