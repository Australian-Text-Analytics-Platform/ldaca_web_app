import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  renameWorkspace,
  saveWorkspace,
  setCurrentWorkspace,
  updateWorkspaceDescription,
} from '@/api';
import { ApiError } from '@/lib/apiError';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateWorkspaceSummaries, isWorkspaceDetailQueryKey } from './workspaceMutationCache';

interface WorkspaceManagementMutationsParams {
  authHeaders: Record<string, string>;
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  clearSelection: () => void;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
  setOperationError: (operationId: string, error: string) => void;
}

/**
 * Owns workspace-level mutations exposed through WorkspaceProvider actions.
 * Used by: useWorkspaceNodeMutations because current-workspace sync and
 * workspace CRUD have different cache/selection behavior from node graph and
 * table transformations.
 * Flow: sync current workspace with the backend, update local selection after
 * confirmed writes, refresh workspace summaries, and return stable action
 * functions for launch/header/settings consumers.
 */
export const useWorkspaceManagementMutations = ({
  authHeaders,
  currentWorkspaceId,
  setCurrentWorkspaceId,
  clearSelection,
  queryClient,
  startOperation,
  endOperation,
  setOperationError,
}: WorkspaceManagementMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };

  const setCurrentWorkspaceOnServer = async (workspaceId: string | null) => {
    const setCurrent = () =>
      setCurrentWorkspace({
        headers: authHeaders,
        query: workspaceId === null ? undefined : { workspace_id: workspaceId },
        throwOnError: true,
      });

    try {
      const { data } = await setCurrent();
      return data;
    } catch (error) {
      if (!(workspaceId !== null && error instanceof ApiError && error.status === 404)) {
        throw error;
      }

      await listWorkspaces({ headers: authHeaders, throwOnError: true });
      const { data } = await setCurrent();
      return data;
    }
  };

  const setCurrentWorkspaceMutation = useMutation<
    Record<string, unknown>,
    Error,
    string | null,
    { previousId: string | null }
  >({
    mutationFn: (workspaceId: string | null) => setCurrentWorkspaceOnServer(workspaceId),
    onMutate: async (workspaceId: string | null) => {
      startOperation('setCurrentWorkspace');
      const previousId = currentWorkspaceId;
      if (!workspaceId && previousId) {
        await queryClient.cancelQueries({
          predicate: ({ queryKey }) => isWorkspaceDetailQueryKey(queryKey, previousId),
        });
      }
      return { previousId };
    },
    onSuccess: (_data, workspaceId, context) => {
      const previousId = context.previousId ?? null;
      const nextId = workspaceId ?? null;
      setCurrentWorkspaceId(nextId);
      clearSelection();

      if (nextId) {
        void queryClient.invalidateQueries({
          predicate: ({ queryKey }) => isWorkspaceDetailQueryKey(queryKey, nextId),
        });
      } else if (previousId) {
        queryClient.removeQueries({
          predicate: ({ queryKey }) => isWorkspaceDetailQueryKey(queryKey, previousId),
        });
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      endOperation('setCurrentWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('setCurrentWorkspace', error.message);
      endOperation('setCurrentWorkspace');
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createWorkspace({
        body: { name, description: description ?? '' },
        headers: authHeaders,
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: () => {
      startOperation('createWorkspace');
    },
    onSuccess: (data) => {
      const newWorkspaceId = (data.id as string | undefined) ?? null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      if (newWorkspaceId) {
        setCurrentWorkspaceId(newWorkspaceId);
        clearSelection();
        void queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      }
      endOperation('createWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('createWorkspace', error.message);
      endOperation('createWorkspace');
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => {
      if (!workspaceId.trim()) {
        throw new Error('workspaceId is required');
      }
      return deleteWorkspace({
        headers: authHeaders,
        query: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onMutate: () => {
      startOperation('deleteWorkspace');
    },
    onSuccess: (data: Record<string, unknown>, workspaceId) => {
      const deletedWorkspaceId = (data.id as string | undefined) ?? workspaceId;
      if (currentWorkspaceId && deletedWorkspaceId === currentWorkspaceId) {
        setCurrentWorkspaceId(null);
        clearSelection();
      }
      invalidateWorkspaceSummaries(queryClient);
      endOperation('deleteWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('deleteWorkspace', error.message);
      endOperation('deleteWorkspace');
    },
  });

  const saveWorkspaceMutation = useMutation({
    mutationFn: () => {
      ensureWorkspaceSelected();
      return saveWorkspace({ headers: authHeaders, throwOnError: true }).then(({ data }) => data);
    },
    onMutate: () => {
      startOperation('saveWorkspace');
    },
    onSuccess: () => {
      endOperation('saveWorkspace');
    },
    onError: (error: Error) => {
      setOperationError('saveWorkspace', error.message);
      endOperation('saveWorkspace');
    },
  });

  const updateWorkspaceNameMutation = useMutation({
    mutationFn: (newName: string) => {
      ensureWorkspaceSelected();
      return renameWorkspace({
        headers: authHeaders,
        query: { new_name: newName },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onMutate: () => {
      startOperation('updateWorkspaceName');
    },
    onSuccess: () => {
      invalidateWorkspaceSummaries(queryClient);
      endOperation('updateWorkspaceName');
    },
    onError: (error: Error) => {
      setOperationError('updateWorkspaceName', error.message);
      endOperation('updateWorkspaceName');
    },
  });

  const updateWorkspaceDescriptionMutation = useMutation({
    mutationFn: (description: string) => {
      ensureWorkspaceSelected();
      return updateWorkspaceDescription({
        headers: authHeaders,
        query: { description },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onMutate: () => {
      startOperation('updateWorkspaceDescription');
    },
    onSuccess: () => {
      invalidateWorkspaceSummaries(queryClient);
      endOperation('updateWorkspaceDescription');
    },
    onError: (error: Error) => {
      setOperationError('updateWorkspaceDescription', error.message);
      endOperation('updateWorkspaceDescription');
    },
  });

  const actions = useMemo(
    () => ({
      setCurrentWorkspace: (workspaceId: string | null) =>
        setCurrentWorkspaceMutation.mutateAsync(workspaceId),
      createWorkspace: (name: string, description?: string) =>
        createWorkspaceMutation.mutateAsync({ name, description }),
      deleteWorkspace: (workspaceId: string) => deleteWorkspaceMutation.mutateAsync(workspaceId),
      saveWorkspace: () => saveWorkspaceMutation.mutateAsync(),
      renameWorkspace: (newName: string) => updateWorkspaceNameMutation.mutateAsync(newName),
      updateWorkspaceDescription: (description: string) =>
        updateWorkspaceDescriptionMutation.mutateAsync(description),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [authHeaders, currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
