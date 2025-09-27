/**
 * @deprecated The monolithic useWorkspace hook has been removed.
 * Use the dedicated slice hooks instead:
 * - useWorkspaceData
 * - useWorkspaceSelection
 * - useWorkspaceActions
 * - useWorkspaceStatus
 */
export function useWorkspace(): never {
  throw new Error(
    'useWorkspace has been removed. Use the slice hooks (useWorkspaceData, useWorkspaceSelection, useWorkspaceActions, useWorkspaceStatus) instead.',
  );
}
