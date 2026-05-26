import {
  getWorkspaceUiStateApiWorkspacesWorkspaceIdUiStateGet,
  putWorkspaceUiStateApiWorkspacesWorkspaceIdUiStatePut,
} from '@/api/generated/sdk.gen';

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
  get: async (workspaceId: string, headers?: Record<string, string>): Promise<WorkspaceUiState> => {
    const { data } = await getWorkspaceUiStateApiWorkspacesWorkspaceIdUiStateGet({
      headers,
      path: { workspace_id: workspaceId },
      throwOnError: true,
    });
    return data as WorkspaceUiState;
  },

  put: async (
    workspaceId: string,
    payload: WorkspaceUiState,
    headers?: Record<string, string>,
  ): Promise<WorkspaceUiState> => {
    const { data } = await putWorkspaceUiStateApiWorkspacesWorkspaceIdUiStatePut({
      body: payload as Record<string, unknown>,
      headers,
      path: { workspace_id: workspaceId },
      throwOnError: true,
    });
    return data as WorkspaceUiState;
  },
};
