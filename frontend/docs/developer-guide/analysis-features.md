# Analysis Feature Patterns

Analysis tabs share the same high-level lifecycle: own an input-node set, submit
or hydrate a request, follow task status through SSE, and refresh request/result
data from the tab-owned task id.

## Tab-Owned State

Tabbed analysis views are hosted by
`src/features/views/common/tabs/AnalysisTabsHost.tsx`. The host loads the
workspace's `tabs.json` sidecar through `useWorkspaceTabs` before rendering the
active feature. Each persisted tab owns:

Canonical tab-group and task-type ids live in
`src/features/views/common/analysisIds.ts`. Tabbed wrappers, feature
`useAnalysisFeature` configs, task-request hydration, and task-stream filtering
should import `ANALYSIS_TAB_GROUPS` / `ANALYSIS_TASK_TYPES` instead of repeating
string literals.

- `tab_id`: the UI identity and React key for that tab;
- `task_id`: the optional backend task/result the tab currently shows;
- `title`: the tab label;
- `input_sets`: named add-as-needed node selector values, each with `node_id`
  and optional `column`; single-selector views use `input_sets.source`, while
  multi-selector views add their own selector ids.
- `settings`: a free-form `Record<string, string>` for small, view-specific
  scalar controls that are not node selectors or task ids. The Annotation tab
  uses it to persist its AI parameter panel — `annotationMode` (`manual`/`ai`),
  `aiProvider` (provider id), `aiModel`, and `aiPrompt`. The host passes the map
  in as `tabSettings` and a `onTabSettingChange(key, value)` writer; discrete
  controls (the Manual/AI switch, the provider dropdown) write through on change
  while free-text fields (model, prompt) commit on blur to avoid a full
  `tabs.json` PUT per keystroke.

When a tab becomes active, the host passes `tabTaskId`, `tabInputs`, and the
named `tabInputSets` map into the feature. The feature must pass `tabTaskId` to
`useAnalysisFeature` as `hydrationTaskId` and provide both
`fetchRequest(taskId, headers)` and `fetchResult(taskId, headers)`. Hydration
then resolves the tab-owned task id, fetches the saved request first, applies
feature parameters from that request, and fetches the result for the same task
id. New runs report their assigned task id through `onTabTaskChange`, which
persists it back to `tabs.json`. The
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
`features/views/common/tasks/runAnalysisTaskEnvelope.ts` is the narrow submit
utility for task flows that share the same running-flag, last-fetched marker,
and task-id handoff pattern. Keep feature-specific request building, result
normalization, detach/materialize actions, and navigation handoffs in the
feature task-flow hook.

Use the shared analysis card Stop and Clear Results actions for task lifecycle
controls. The sidebar Task Center should not own cancellation or clearing;
feature tabs know which task ids and descendants the backend should resolve.

## Node Inputs And Visualization Colours

Analysis tabs use the add-node-as-needed model. `NodeInputsPanel` is the shared
UI for selecting data blocks, selecting the per-node column when a feature needs
one, adding graph/recent presets, removing nodes, and clearing a tab's inputs.
`useTabNodeInputs` binds the panel to a tab's persisted selector value and live
workspace node metadata. Single-selector views use the default `source`
selector; multi-selector views pass a `selectorId` and persist through
`input_sets`. `nodeInputsFromSelections` is the shared adapter for hydration and
handoff paths that receive `{nodeId, column}` selections and need to persist
`AnalysisTabInput` records. The current graph selection is only a source for
"Add preset" or graph-node add buttons; it is not the analysis input state.
Graph/sidebar `+` buttons queue a workspace + active
view request in `nodeInputRequestsStore`. By default, `useTabNodeInputs`
consumes matching requests directly into that selector. Multi-selector features
set `consumeNodeInputRequests: false` on every participating selector, leaving
the request pending so each visible `NodeInputsPanel` with add controls can show
the dashed "Add here" chooser.

Feature-specific caps are enforced through `NodeInputConstraints`:

- token frequency, concordance, and topic modeling allow one or two document
  nodes;
- sequential analysis and quotation use one node;
- annotation uses one source text node plus a second class-description selector;
- preprocessing stores per-subtab inputs in `preprocessingInputsStore` and
  renders the same `NodeInputsPanel` inside each subtab parameter card;
- export remains graph-selection based because it acts on workspace nodes rather
  than an analysis tab.

Analysis visualizations derive fallback source colours from
`views/common/vizPalette.ts`. Analysis tabs that colour results by selected
source node read the node's persisted `Node.color`; when a selected node has no
stored colour yet, the tab assigns the deterministic palette default and posts
it to the workspace before starting the analysis. User picker changes are sent
through the node-colour endpoint immediately, not bundled into analysis
requests.

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
`PUT /workspaces/{workspace_id}/nodes/{node_id}/document-column`; other
document-oriented analysis selectors use the same endpoint instead of mutating
node metadata in their submit routes. The tokenizer selector samples the first
page of the selected column via
`GET /workspaces/{workspace_id}/nodes/{node_id}/data`, runs MediaPipe Language
Detector in the browser, normalizes the result to ISO 639-1, and fetches the
backend tokenizer inventory from `GET /workspaces/tokenizer-models` when the
dropdown opens. Models whose backend-provided `languages` include the detected
code are rendered first in a recommended group. Choosing a model calls
`PUT /workspaces/{workspace_id}/nodes/{node_id}/tokenization-preference`, so
token frequency requests rely on `Node.tokenization` metadata rather than
sending frontend-owned model maps. Choosing the placeholder model clears that
column's tokenization preference; choosing the placeholder column clears
`Node.document`. Default
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

## Annotation

Annotation is currently a setup/editing tabbed view. Its source selector is
backed by `input_sets.source` and accepts one string text column plus an
Annotation-specific companion column picker with a `Start new annotation`
option. Class descriptions use the same `useTabNodeInputs` hook with the
`classDescriptions` selector id and persist under `input_sets.classDescriptions`.
The class-description selector and a compact class summary live in one analysis
card. The `Add new` button calls
`POST /api/workspaces/{workspace_id}/annotation/class-descriptions`, which creates an empty
two-column `class`/`description` data block in the active workspace and selects
it for the class-description panel. The card shows the configured class names as
compact badges (descriptions hidden, extras collapsed into a `+N more` badge);
each badge whose class has a non-empty description exposes that description in a
hover tooltip (badges without a description render bare, with no tooltip). An
`Edit` button opens a dialog that lists every `class`/`description` row with
per-row inputs, a trash button to delete a class, and an `Add class` button to
append one. The dialog fetches and saves through
`GET /api/workspaces/{workspace_id}/annotation/class-descriptions/{node_id}` and
`PUT /api/workspaces/{workspace_id}/annotation/class-descriptions/{node_id}`, persisting each
class/description edit on blur and each add/delete immediately (the whole node is
rewritten). The `Edit` button stays enabled even after annotation has started so
reviewers can amend classes on the go (it only greys out while the class list is
still loading or no class node is selected). The card footer
shows one run button that toggles on the source node's annotation column:
`Start` when the column is `Start new annotation`, otherwise `Resume`. When
the column is `Start new annotation`, a `New Column Name` input appears inside the
selected source-node card; its grayed placeholder defaults to the next free
`annotation`/`annotation_1`/... name based on the source node's columns. The
class-description selector only accepts tables with exactly two string columns
(`exactStringColumns: 2`); ineligible workspace adds are rejected with a toast.

Pressing `Start` in `Start new annotation` mode does three things in
`handleRunAnnotation`: (1) it creates the empty string annotation column on the
source node via `POST /api/workspaces/{workspace_id}/annotation/source/{node_id}/annotation-column`
(the request name is the `New Column Name` value or its default); (2) it reparents
the class node under the source node via
`PUT /api/workspaces/{workspace_id}/annotation/class-descriptions/{node_id}/parent`; and (3)
after invalidating the graph/nodes/node-data queries it points the source
annotation-column dropdown at the newly created column, switching the card from
start-new mode into resume mode. `Resume` skips column creation and just reveals
the results. Once a run has started (`hasRun`, or the brief `isStarting` request
window), the whole setup locks: `isLocked` disables both `NodeInputsPanel`s, the
annotation/description column pickers, the `New Column Name` input, and the
`Add new` class button. The run button then reads `Reset`; `handleReset` clears
the results and unlocks the panel while leaving the source node pointed at the
column Start created — the card drops back into resume mode on that same column
(button now `Resume`), rather than reverting to `Start new annotation`. After
Start/Resume, a results panel below the parameter panel shows the source text
column beside the annotation column in a fixed two-column layout (wraps, no
horizontal scroll, TanStack server pagination); each annotation cell is a
dropdown of class names from the class-description node plus a leading `None`
option (Resume seeds the existing value, new starts blank). Picking a class
persists that cell to the backend annotation column via
`PUT /api/workspaces/{workspace_id}/annotation/source/{node_id}/annotation-cell` (body
`column_name`, absolute `row_index`, and `value`; `None`/blank sends `null`).
The dropdown updates optimistically and the panel invalidates the node-data
query on success so other views see the saved value; on failure it rolls the
cell back to its prior value and shows an error toast. The `row_index` is the
absolute 0-based position across the node (`pageIndex * pageSize + rowOffset`),
matching the backend's Polars `int_range` cell rewrite.

Below the Class Descriptions card a `Manual`/`AI` shadcn `Switch`
(`annotationMode` state) chooses the annotation workflow. In `Manual` mode the
card footer renders the Start/Resume/Reset button described above; in `AI` mode
the footer instead renders a `Preview` / `Close preview` button (gated by
`canAnnotate` plus a class node with both columns chosen **and at least one class
row** — an empty class node offers nothing to classify into, so `AnnotationFeature`
loads the class-descriptions rows via a deduped `getAnnotationClassDescriptions`
query and requires a non-blank class count before enabling Preview) that toggles
the `AnnotationAiPreviewPanel`. AI mode has no Resume — a single batch
fills every cell — so the button is always `Preview`. Opening it reuses the
manual Start lifecycle (`handleRunAnnotation`, refactored to return whether the
run started): the first `Preview` over a `Start new annotation` column creates
that column, reparents the class node, switches the picker into resume mode, and
locks the selectors just like manual Start (the class `Edit` button stays enabled
throughout, since it is never gated by `isLocked`); the panel only opens once the
run is locked so its first page fetch already sees the new column. `Close preview`
hides the panel and unlocks the parameter panel (like manual Reset) while keeping
the source pointed at the created column, so re-opening resumes that column and
never recreates it. Closing also fires `/api/workspaces/{workspace_id}/annotation/ai/preview/clear`
(`annotateAiPreviewClear`) to drop the node's **server-side** preview session —
the deliberate asymmetry versus a tab switch, which only unmounts the panel and
keeps the cache so it can rehydrate — so a re-open re-classifies from scratch and
no stale detach/annotate-all count lingers. The clear is fire-and-forget: a failed
cleanup never blocks closing the panel. The manual `AnnotationResultsPanel` is gated to `Manual` mode, so AI
mode shows only the preview. Alongside the switch an
`AnnotationAiSettings` block appears with an instance-based provider-card
dropdown, a model field, and an optional example-node selector. The dropdown is
empty until the user adds a provider card; each card stores one provider choice,
API key, and model, then renders as provider label + model name. The add/edit
dialog lets users choose a built-in provider or a custom OpenAI-compatible base
URL; saving writes API keys/custom endpoints to preferences and per-card models
to tab settings. The provider catalogue lives in `annotation/aiProviders.ts`,
which is pure metadata for display names, key requirements, built-in category
mapping, and model-list support. Actual LLM traffic (preview and annotate-all)
runs server-side under `/api/workspaces/{workspace_id}/annotation/ai/*`; OpenRouter's public model catalogue is
the exception and is fetched client-side by `ModelNameCombobox` so the dropdown
can show input/output prices from `GET https://openrouter.ai/api/v1/models`.
The four hosted providers (OpenRouter/OpenAI/Anthropic/Google) are static;
configured built-in cards use opaque `provider:<provider>:<uuid>` ids that
resolve back to their category for backend requests, while custom providers use
`custom:<uuid>` ids and treat the key as optional (local servers such as Apple's
`fm serve`, Ollama, and LM Studio often need none). `ModelNameCombobox` renders
the model field: OpenRouter uses the direct client fetch with pricing; other
listable providers fetch lazily through React Query by calling the backend
(`listAnnotationAiModels` -> `POST /api/workspaces/{workspace_id}/annotation/ai/models`, keyed by provider +
base URL + key, enabled only while the popover is open and the key requirement
is met). The list is wildcard-filtered as the user types, clicking a row fills
the field, and the input stays free-text either way, so a custom endpoint that
lacks a `/models` route just surfaces the backend error in the popover while the
user types an id by hand. The example-node selector reuses `NodeInputsPanel` through a third
`useTabNodeInputs` selector (`exampleNodes`, one string node, text + plain
annotation column pickers — no `Start new annotation` option) so a few-shot
example block can later seed AI annotation. Directly under the example block, `AnnotationPromptInput`
(`aiPrompt` state) edits the instruction prompt sent to the provider: while the
field is empty `DEFAULT_ANNOTATION_PROMPT` shows grayed as the textarea
placeholder, and the user can either type their own prompt or press `Tab` to
accept the default and edit from there (Tab is intercepted only while the field
is empty, so it resumes normal focus traversal once content exists). Below the
prompt, a collapsed-by-default **Model Configuration** disclosure
(`AnnotationInferenceSettings`, built on the shadcn `Collapsible`) exposes the
provider-agnostic inference knobs applied to whichever provider is selected: a
**Temperature** number input (default `0`, clamped to `[0, 2]` on blur, reseeded
via a `key` like the API-key field) and a **Reasoning** shadcn `Switch` (default
off); flipping reasoning on reveals a **Thinking effort** select
(`low`/`medium`/`high`, default `medium`). When the parameter panel is locked
(a run/preview is active) the disclosure still opens so the values a run is using
can be inspected — only its inner inputs go read-only, so unlike the other
selectors the trigger itself is never disabled. API keys (keyed by provider-card
id) and custom providers are persisted to backend preferences through the
preferences store (`annotationAiApiKeys` / `annotationAiCustomProviders`), which
debounce-syncs an `annotation_ai` payload to the unified `PUT /preferences/`
endpoint (TOML-backed, modeled by `AnnotationAiPreferences` /
`AnnotationAiCustomProvider`). The remaining AI settings state (mode, active
provider-card id, active model, per-card model map, and the instruction prompt)
is local mirror state in `AnnotationFeature` that is seeded from and written back
to the tab's `settings` map (`annotationMode`/`aiProvider`/`aiModel`/`aiPrompt`/
`aiProviderModels`, plus the Model Configuration knobs
`aiTemperature`/`aiReasoningEnabled`/`aiReasoningEffort`, booleans stringified as
`'true'`/`'false'` and the temperature as `String(value)`) through
`onTabSettingChange`, so the whole parameter panel — like the source and class
node selectors — survives reloads and tab switches; the example-node selector
persists separately through its `exampleNodes` `input_sets` entry. API keys stay
out of `tabs.json` and live only in preferences. Every AI control plus the mode
switch locks once annotation has started. Settings -> AI
(`AiProvidersPreferencesPanel`) still manages preference-level provider keys and
registered custom provider definitions.

The `Preview` button runs AI annotation through the backend via
`AnnotationAiPreviewPanel`. For the current page of the source node (20 rows per
page) it POSTs `/api/workspaces/{workspace_id}/annotation/ai/preview` (`annotateAiPreview`) with the source
node id, text column, class node/columns, provider id + optional custom base
URL, API key, model, instruction, and page — and renders the structured per-row
class predictions the backend returns (`{"labels":[...]}` aligned to the page's
rows). The Model Configuration knobs (`temperature`, `reasoning_enabled`,
`reasoning_effort`) ride along in both the preview and annotate-all bodies (and in
the preview panel's React Query key), so the backend applies them per request. The backend engine (`core/annotation_ai.py`) re-slices the same page,
loads the authoritative class list, builds the system/user prompt, and dispatches
the provider's **native async SDK** — `AsyncOpenAI` for `openai`-style providers
(OpenRouter/OpenAI and OpenAI-compatible custom endpoints, distinguished only by
base URL), `AsyncAnthropic` for Anthropic, and the `google-genai` async client
for Google — coercing each returned label to a known class name
(case-insensitively) or null so there is always exactly one entry per text. Keys
travel only over the app's own authenticated API; the browser never calls a
provider. A failed page shows the backend error message (provider failures
surface as `502`) with a `Retry`. Because a page batch can outlast the generated
client's default 30s timeout, preview requests set the opt-in
`x-client-timeout-ms` header (see `generatedClientConfig.ts`) to raise the
client-side cap.

Preview predictions are **cached and persisted in the backend**, not just the
browser. A process-lifetime preview store (`core/annotation_preview_store.py`,
keyed by user + workspace + node) records every previewed row under a *signature*
hashed from the prediction-affecting config only — text column, class node/
columns, provider, base URL, model, instruction, temperature, and the reasoning
knobs, but **not** the annotation column or page. So re-viewing a page reuses the
stored labels (the endpoint only calls `annotate_batch` for rows it has not seen
under the current signature — no repeat spend), and changing any
prediction-affecting knob resets that node's rows. The store is in-memory: it
survives tab switches but is cleared on backend restart.

That store makes the panel **survive tab switches** like concordance/quotation.
`AnnotationFeature` persists an `aiPreviewOpen` tab setting (so `isPreviewing`
re-seeds and the panel reopens on remount), and on mount the panel fires a
`/api/workspaces/{workspace_id}/annotation/ai/preview/state` (`annotateAiPreviewState`) query — keyed by the
same signature config, minus annotation column and page, and set to
`refetchOnMount: 'always'` — that folds every genuine override back into
`selections` inside its `queryFn`. The AI labels themselves come back through the
per-page annotate query's cache (its returned data, not a side effect, so a cache
hit is enough), while the override fold has to re-run on every remount because the
local `selections` map is wiped on unmount; that is why the state query force-
refetches on mount. Leaving the tab and coming back therefore restores every
previewed page, its labels, and any manual edits. Each prediction cell is still a
dropdown seeded from the model's label that the user can override; changing it
writes through to the store via `PUT /api/workspaces/{workspace_id}/annotation/ai/preview/override`
(`annotateAiPreviewOverride`) so the edit persists too. When a previewed row
already holds a value in the annotation column (previewing over an existing or
partly filled column), that existing label is rendered struck through beside the
AI prediction dropdown, so overwriting a pre-filled cell is obvious; a freshly
created `Start new annotation` column is empty, so nothing is struck through.

The preview panel's footer also has an **Annotate All** button that persists a
full run: it POSTs `/api/workspaces/{workspace_id}/annotation/ai/annotate-all` (`annotateAiAll`), where the
backend reuses the store's cached labels for already-previewed rows and fans only
the remainder out over concurrent batches (`asyncio.gather` under a semaphore,
order preserved), overwrites the whole annotation column in one go via
`stage_dataframe_as_lazy` + `update_workspace`, clears the node's preview session,
and returns the labelled/total counts. On success the panel toasts the counts,
resets the detach-count probe to `0` (the session is now empty), and invalidates
the node-data and workspace-graph queries so the filled column shows everywhere.
It uses a longer `x-client-timeout-ms` since the single HTTP call can span the
uncached batches.

Beside it (to the left) is a **Detach Previewed Rows** button that materializes
every page the user has previewed — across all viewed pages, not just the current
one. Clicking it opens a shadcn `ConfirmDialog` that names how many rows will
detach; confirming does the write. Both the button's *enablement* and that count
come from a **dry-run probe**: a `detachAiPreviewedRows` call with `dry_run: true`
(`detachCountQuery`) that asks the backend how many rows the preview session holds
without materialising anything. This is what fixes the "Detach is disabled after a
tab switch even though rows were previewed" bug — the browser's per-page map is
gone on remount, so the panel asks the server (the source of truth) instead. The
probe uses `refetchOnMount: 'always'` (re-enables on tab return), the per-page
annotate query invalidates its key as new pages are previewed (the count climbs
live), and Annotate All resets it to `0`. Confirming POSTs
`/api/workspaces/{workspace_id}/annotation/ai/detach-previewed` (`detachAiPreviewedRows`) with just the node +
column (no `dry_run`), and the endpoint reads the whole preview session (effective
label = override ?? AI) — which also fixes the earlier "detach only grabs the
current page" bug. The endpoint copies exactly those source rows into a **new
child node** of the source (via `_create_and_persist_child_node`) with the labels
written into the annotation column (blanks coerced to null); it never calls the
LLM or mutates the source. On success the panel toasts the detached-row count and
invalidates the workspace-graph/node-list queries so the child appears. The two
footer buttons disable each other while either mutation is in flight so the writes
never overlap.

## Topic Modeling

Topic modeling submits BERTopic/embedding work through backend workers. The UI
handles minimum topic size, percentage sampling per corpus, random seed,
representative words, and chart interactions. `useTopicModelingParameters`
owns the run parameter model so request hydration, clear behavior, sampling
warnings, and `sample_fractions` diffing stay aligned. Its scalar value/user-set
pairs and sampling defaults are backed by `topicModelingParameterState.ts`,
keeping hydration and Clear Results transitions testable without rendering the
feature.
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

## Adding A New Analysis Tab

Start from `AnalysisTabsHost`, `NodeInputsPanel`/`useTabNodeInputs`, the shared
common hooks, and generated backend SDK/types. Add backend schema models first
when a generated response would otherwise become `unknown`.

The minimum task-backed contract is:

- accept `tabId`, `tabTaskId`, `onTabTaskChange`, `tabInputs`, and
  `onTabInputsChange` from `AnalysisTabFeatureProps`; accept `tabInputSets`
  and `onTabInputSetChange` only when the view has multiple node selectors;
- pass `tabTaskId ?? null` as `hydrationTaskId` to `useAnalysisFeature`;
- implement `fetchRequest` and `fetchResult` through the shared
  `/workspaces/{workspace_id}/analysis-tasks/{task_id}/request` and
  `/result` endpoints;
- send task follow-up actions through the same shared task namespace:
  `detach-options`, `detachments`, `dispersion-bins`,
  `dispersion-detachments`, and `materializations` as applicable, with node ids
  in the query/body and the parent task id in the path;
- call `onTabTaskChange(taskId)` when a run assigns a backend task id;
- call `onTabTaskChange(null)` when Clear Results removes the tab's task;
- use `tabInputs`/`input_sets.source` as the only source-selector state,
  seeding it from hydrated task requests when opening an existing task id;
- for small scalar controls that are not node selectors or the task id, accept
  `tabSettings`/`onTabSettingChange` and keep them as local mirror state seeded
  from `tabSettings` (write through on change for discrete inputs, commit on
  blur for free-text), rather than transient `useState`.

Keep task refresh event-driven, and expose detach or materialize flows only
through workspace actions so graph invalidation remains centralized.
