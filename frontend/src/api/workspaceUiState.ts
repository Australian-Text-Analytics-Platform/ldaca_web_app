import { get, put } from './http';

/** Shape of the ``ui_state.json`` sidecar persisted alongside the
 * workspace's ``metadata.json``. Free-form JSON object so we can grow
 * it (column-visibility prefs, layout, etc.) without a backend
 * release. The frontend currently only writes ``node_colors``. */
export interface WorkspaceUiState {
  /** Assigned node colour map. Hex strings keyed by docworkspace nodeId.
   * Mirrors ``useNodeColorsStore.colors`` at PUT time. */
  node_colors?: Record<string, string>;
}

export const workspaceUiStateApi = {
  get: (workspaceId: string, headers?: Record<string, string>) =>
    get<WorkspaceUiState>(
      `/workspaces/${encodeURIComponent(workspaceId)}/ui-state`,
      headers,
    ),

  put: (
    workspaceId: string,
    payload: WorkspaceUiState,
    headers?: Record<string, string>,
  ) =>
    put<WorkspaceUiState>(
      `/workspaces/${encodeURIComponent(workspaceId)}/ui-state`,
      payload,
      headers,
    ),
};
