# Frontend State And Data Flow

## Server And Client State

TanStack Query owns server-derived resources, request identity, and cache
invalidation. Zustand owns cross-feature client interaction state such as the
active view, selected Workspace/Data Blocks, preferences, and transient
background-work presentation. Local component state owns form and panel
interaction.

```mermaid
flowchart TB
    BACKEND["Backend JSON resources and refresh events"] --> QUERY["TanStack Query<br/>server-state authority"]
    ARROW["Backend Arrow IPC tables"] --> DECODER["Official Apache Arrow decoder<br/>rows, fields, has-next"]
    DECODER --> FEATURES
    QUERY --> FEATURES["Feature hooks and components"]

    ZUSTAND["Zustand<br/>cross-feature interaction authority"] <--> FEATURES
    LOCAL["Component state<br/>forms and panels"] <--> FEATURES
    URL["URL search state<br/>view identity"] <--> ZUSTAND
    BROWSER_CREDENTIALS["Per-user Provider Credentials<br/>versioned localStorage"] --> CREDENTIAL_FACADE["Mode-specific credential facade<br/>presence and request-boundary injection"]
    CREDENTIAL_FACADE --> FEATURES
    CREDENTIAL_FACADE --> BACKEND

    FEATURES --> GRAPH["React Flow Workspace graph"]
    FEATURES --> TABLES["Result and data tables"]
    FEATURES --> PANELS["Analysis and preprocessing panels"]

    GRAPH -. "volatile callbacks read live state" .-> ZUSTAND
```

Feature code consumes generated SDK functions and generated types through
`@/api`. The narrow table adapter decodes generated-client binary responses
with `apache-arrow`; complete Result table URLs use the same decoder directly.
It classifies columns through official Arrow types, including view and
large-offset representations emitted natively by Polars. Decoder failures stay
ordinary errors on the affected table query and retain the underlying Arrow
cause.
Known semantic extension names select specialized behavior such as the Topic
Distribution renderer. An unrecognized extension remains addressable as
`extension:<exact-name>` and retains its Arrow field metadata instead of being
collapsed into the generic `unknown` category.
Raw network calls are limited to boundaries the generator cannot express
conveniently, such as complete table URLs, native downloads, or SSE, and still
follow the backend's cookie, CSRF, Origin, and typed resource contracts. There
is no JSON table decoder, backend compatibility rewrite, or alternate decoder.

Provider Credentials are an intentional separate boundary. In multi-user mode,
a non-devtools Zustand store persists secrets by authenticated user ID under
`wordflow-provider-credentials` and exposes only presence metadata to
components. A request facade reads the current account's secret synchronously
inside the final generated SDK call. Safe credential revision numbers may
invalidate model and preview queries; secret values never enter query keys,
mutation variables, Tab state, hydrated requests, errors, or telemetry. Logout
does not delete another account's browser partition, and browser storage events
synchronize replacement and deletion across tabs. In single-user mode, the
same facade uses backend status and write-only mutations and never creates a
browser credential entry.

Frontend-owned Data Block reads use Workspace SQL through a narrow handwritten
adapter around the generated mixed-response operation. The adapter asserts
Arrow content for query mode and JSON for creation mode. SQL builders own
identifier quoting, literal escaping, glob translation, and explicit null
ordering. Query keys contain every declared Data Block ID so edit, history, and
delete invalidation clears dependent SQL pages.

## Workspace Composition

`WorkspaceProvider` presents focused data, selection, status, and action
slices. Workspace identity is always explicit in server query keys and
requests. Client selection is not permission to call an implicit backend
Workspace.

Dagre derives canonical graph positions from Workspace identity, ordered Data
Block IDs, and lineage endpoints. React Flow owns only temporary drag positions
and its internal node cache while that topology is unchanged; a Workspace or
topology change replaces every position with the new Dagre layout. Positions
are not persisted. Graph callbacks that depend on volatile UI state must read
that state when invoked unless the value is part of the graph's
resynchronization signature; otherwise a view switch can leave a cached
callback stale.

## Analysis Lifecycle

Analysis features own their selected Data Blocks, current Tab and Analysis
identity, request hydration, and Result projection. Resource refresh events
invalidate the query cache; the owning feature retains workflow controls
because it knows the root/child Analysis relationship.

Execution delivery is explicit at the feature adapter. Immediate operations
store their returned Result directly. Tab-owned background submissions use the
shared Analysis submission envelope, which records lifecycle identity and keeps
the Result projection empty until terminal success. A hybrid operation must
discriminate its immediate and background response branches before applying
either adapter; callers never infer Result availability from response
truthiness.

The active Tab is device-local presentation state, stored in localStorage by
Workspace and analysis kind. Returning to an analysis view or reloading the
client restores the last Tab when that backend Tab still exists. Missing or
deleted Tab IDs fall back to the first available Tab and repair the local entry;
the backend remains authoritative for Tab identity, content, and ownership.

Action availability follows the Analysis attached to the Tab, not whether that
Analysis produced a Result. An attached queued or running Analysis cannot be
replaced. Failed and cancelled Analyses can be cleared or retried unchanged;
successful Analyses can be re-run after the request changes. Re-run first clears
the attached Analysis and submits the replacement only after that clear
succeeds, preserving the one-root-Analysis-per-Tab invariant.

Preprocessing preview identity includes every serialized input. Switching an
input cancels the previous request and late responses cannot replace the new
state.

Filter, Find, Create, and Polars Expression keep their create/update choice in
local component state. Create is the default, and changing the tool or selected
Data Block resets the choice; it is not an account or device preference.
Sample, Join, and Stack expose no update mode. Successful edits and history
commands invalidate the graph, node metadata, row, and schema queries together.
Data View and graph menus derive Undo/Redo disabled state only from the
backend's `can_undo` and `can_redo` flags.

## Documentation Registry

The bundled registry keeps help available offline; a valid remote registry may
shadow bundled entries. `frontend/scripts/check-docs-drift.mjs` validates
registered documents, anchors, relative links, and literal consumer keys.
