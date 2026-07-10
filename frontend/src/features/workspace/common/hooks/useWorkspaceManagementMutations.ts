import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import {
  createWorkspace,
  deleteWorkspaceById,
  listWorkspaces,
  saveWorkspaceById,
  setMyCurrentWorkspace,
  updateWorkspaceById,
} from '@/api';
import { ApiError } from '@/lib/apiError';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateWorkspaceSummaries, isWorkspaceDetailQueryKey } from './workspaceMutationCache';
import { createWorkspaceOperationLifecycle } from './workspaceMutationLifecycle';

interface WorkspaceManagementMutationsParams {
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  clearSelection: () => void;
  queryClient: QueryClient;
  startOperation: (operationId: string) => void;
  endOperation: (operationId: string) => void;
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
  currentWorkspaceId,
  setCurrentWorkspaceId,
  clearSelection,
  queryClient,
  startOperation,
  endOperation,
}: WorkspaceManagementMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };
  const operationLifecycle = createWorkspaceOperationLifecycle({
    startOperation,
    endOperation,
  });

  const setCurrentWorkspaceOnServer = async (workspaceId: string | null) => {
    const setCurrent = () =>
      setMyCurrentWorkspace({
        body: { workspace_id: workspaceId },
        throwOnError: true,
      });

    try {
      const { data } = await setCurrent();
      return data;
    } catch (error) {
      if (!(workspaceId !== null && error instanceof ApiError && error.status === 404)) {
        throw error;
      }

      await listWorkspaces({ throwOnError: true });
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
    onMutate: operationLifecycle.onMutate(
      'setCurrentWorkspace',
      async (workspaceId: string | null) => {
        const previousId = currentWorkspaceId;
        if (!workspaceId && previousId) {
          await queryClient.cancelQueries({
            predicate: ({ queryKey }) => isWorkspaceDetailQueryKey(queryKey, previousId),
          });
        }
        return { previousId };
      },
    ),
    onSuccess: operationLifecycle.onSuccess(
      'setCurrentWorkspace',
      (_data, workspaceId, context) => {
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
      },
    ),
    onError: operationLifecycle.onError('setCurrentWorkspace'),
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createWorkspace({
        body: { name, description: description ?? '' },
        throwOnError: true,
      }).then(({ data }) => data),
    onMutate: operationLifecycle.onMutate('createWorkspace'),
    onSuccess: operationLifecycle.onSuccess('createWorkspace', (data) => {
      const newWorkspaceId = (data.id as string | undefined) ?? null;
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
      if (newWorkspaceId) {
        setCurrentWorkspaceId(newWorkspaceId);
        clearSelection();
        void queryClient.invalidateQueries({ queryKey: queryKeys.currentWorkspace });
      }
    }),
    onError: operationLifecycle.onError('createWorkspace'),
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => {
      if (!workspaceId.trim()) {
        throw new Error('workspaceId is required');
      }
      return deleteWorkspaceById({
        path: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onMutate: operationLifecycle.onMutate('deleteWorkspace'),
    onSuccess: operationLifecycle.onSuccess(
      'deleteWorkspace',
      (data: Record<string, unknown>, workspaceId) => {
        const deletedWorkspaceId = (data.id as string | undefined) ?? workspaceId;
        if (currentWorkspaceId && deletedWorkspaceId === currentWorkspaceId) {
          setCurrentWorkspaceId(null);
          clearSelection();
        }
        invalidateWorkspaceSummaries(queryClient);
      },
    ),
    onError: operationLifecycle.onError('deleteWorkspace'),
  });

  const saveWorkspaceMutation = useMutation({
    mutationFn: () => {
      const workspaceId = ensureWorkspaceSelected();
      return saveWorkspaceById({
        path: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onMutate: operationLifecycle.onMutate('saveWorkspace'),
    onSuccess: operationLifecycle.onSuccess('saveWorkspace'),
    onError: operationLifecycle.onError('saveWorkspace'),
  });

  const updateWorkspaceNameMutation = useMutation({
    mutationFn: (newName: string) => {
      const workspaceId = ensureWorkspaceSelected();
      return updateWorkspaceById({
        body: { name: newName },
        path: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onMutate: operationLifecycle.onMutate('updateWorkspaceName'),
    onSuccess: operationLifecycle.onSuccess('updateWorkspaceName', () => {
      invalidateWorkspaceSummaries(queryClient);
    }),
    onError: operationLifecycle.onError('updateWorkspaceName'),
  });

  const updateWorkspaceDescriptionMutation = useMutation({
    mutationFn: (description: string) => {
      const workspaceId = ensureWorkspaceSelected();
      return updateWorkspaceById({
        body: { description },
        path: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onMutate: operationLifecycle.onMutate('updateWorkspaceDescription'),
    onSuccess: operationLifecycle.onSuccess('updateWorkspaceDescription', () => {
      invalidateWorkspaceSummaries(queryClient);
    }),
    onError: operationLifecycle.onError('updateWorkspaceDescription'),
  });

  const actions = useMemo(
    () => ({
      setCurrentWorkspace: (workspaceId: string | null) =>
        setCurrentWorkspaceMutation.mutateAsync(workspaceId),
      createWorkspace: (name: string, description?: string) =>
        createWorkspaceMutation.mutateAsync({ name, description }),
      deleteWorkspace: (workspaceId: string) => deleteWorkspaceMutation.mutateAsync(workspaceId),
      saveWorkspace: () => saveWorkspaceMutation.mutateAsync(undefined),
      renameWorkspace: (newName: string) => updateWorkspaceNameMutation.mutateAsync(newName),
      updateWorkspaceDescription: (description: string) =>
        updateWorkspaceDescriptionMutation.mutateAsync(description),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
