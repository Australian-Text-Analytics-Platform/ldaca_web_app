import { useMemo } from 'react';
import { type QueryClient, useMutation } from '@tanstack/react-query';
import {
  createWorkspace,
  deleteWorkspaceById,
  closeWorkspaceById,
  openWorkspaceById,
  updateWorkspaceById,
} from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateWorkspaceSummaries, isWorkspaceDetailQueryKey } from './workspaceMutationCache';

interface WorkspaceManagementMutationsParams {
  currentWorkspaceId: string | null;
  queryClient: QueryClient;
}

/**
 * Owns workspace-level mutations exposed through WorkspaceProvider actions.
 * Used by: useWorkspaceNodeMutations because current-workspace sync and
 * workspace CRUD have different cache/selection behavior from node graph and
 * table transformations.
 * Flow: command the backend Workspace lifecycle, refresh its authoritative
 * resource list, and return stable action functions for launch/header/settings
 * consumers. No client-side current-Workspace mirror is written.
 */
export const useWorkspaceManagementMutations = ({
  currentWorkspaceId,
  queryClient,
}: WorkspaceManagementMutationsParams) => {
  const ensureWorkspaceSelected = () => {
    if (!currentWorkspaceId) {
      throw new Error('No workspace selected');
    }
    return currentWorkspaceId;
  };
  const setCurrentWorkspaceOnServer = async (workspaceId: string | null) => {
    if (workspaceId === null) {
      if (!currentWorkspaceId) return null;
      return closeWorkspaceById({
        path: { workspace_id: currentWorkspaceId },
        throwOnError: true,
      });
    }
    const { data } = await openWorkspaceById({
      path: { workspace_id: workspaceId },
      throwOnError: true,
    });
    return data;
  };

  const setCurrentWorkspaceMutation = useMutation<
    unknown,
    Error,
    string | null,
    { previousId: string | null }
  >({
    mutationKey: ['workspace', 'set-current'],
    mutationFn: (workspaceId: string | null) => setCurrentWorkspaceOnServer(workspaceId),
    onMutate: async (workspaceId: string | null) => {
      const previousId = currentWorkspaceId;
      if (!workspaceId && previousId) {
        await queryClient.cancelQueries({
          predicate: ({ queryKey }) => isWorkspaceDetailQueryKey(queryKey, previousId),
        });
      }
      return { previousId };
    },
    onSuccess: async (_data, workspaceId, context) => {
      const previousId = context.previousId ?? null;
      const nextId = workspaceId ?? null;

      if (nextId) {
        void queryClient.invalidateQueries({
          predicate: ({ queryKey }) => isWorkspaceDetailQueryKey(queryKey, nextId),
        });
      } else if (previousId) {
        queryClient.removeQueries({
          predicate: ({ queryKey }) => isWorkspaceDetailQueryKey(queryKey, previousId),
        });
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList, exact: true });
    },
  });

  const createWorkspaceMutation = useMutation({
    mutationKey: ['workspace', 'create'],
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      createWorkspace({
        body: { name, description: description ?? '' },
        throwOnError: true,
      }).then(({ data }) => data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList, exact: true });
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationKey: ['workspace', 'delete'],
    mutationFn: (workspaceId: string) => {
      if (!workspaceId.trim()) {
        throw new Error('workspaceId is required');
      }
      return deleteWorkspaceById({
        path: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(() => undefined);
    },
    onSuccess: () => {
      invalidateWorkspaceSummaries(queryClient);
    },
  });

  const updateWorkspaceNameMutation = useMutation({
    mutationKey: ['workspace', 'rename'],
    mutationFn: (newName: string) => {
      const workspaceId = ensureWorkspaceSelected();
      return updateWorkspaceById({
        body: { name: newName },
        path: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onSuccess: () => {
      invalidateWorkspaceSummaries(queryClient);
    },
  });

  const updateWorkspaceDescriptionMutation = useMutation({
    mutationKey: ['workspace', 'update-description'],
    mutationFn: (description: string) => {
      const workspaceId = ensureWorkspaceSelected();
      return updateWorkspaceById({
        body: { description },
        path: { workspace_id: workspaceId },
        throwOnError: true,
      }).then(({ data }) => data);
    },
    onSuccess: () => {
      invalidateWorkspaceSummaries(queryClient);
    },
  });

  const actions = useMemo(
    () => ({
      setCurrentWorkspace: (workspaceId: string | null) =>
        setCurrentWorkspaceMutation.mutateAsync(workspaceId),
      createWorkspace: (name: string, description?: string) =>
        createWorkspaceMutation.mutateAsync({ name, description }),
      deleteWorkspace: (workspaceId: string) => deleteWorkspaceMutation.mutateAsync(workspaceId),
      saveWorkspace: async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList, exact: true });
      },
      renameWorkspace: (newName: string) => updateWorkspaceNameMutation.mutateAsync(newName),
      updateWorkspaceDescription: (description: string) =>
        updateWorkspaceDescriptionMutation.mutateAsync(description),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation refs intentionally omitted; mutateAsync identities are stable
    [currentWorkspaceId, queryClient],
  );

  return { actions } as const;
};
