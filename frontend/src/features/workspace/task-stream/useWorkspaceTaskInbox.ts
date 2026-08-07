import { useCallback, useEffect } from 'react';
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  cancelUserFileImport,
  deleteUserFileImport,
  getAnalysis,
  getUserFileImport,
  listUserFileImports,
} from '@/api';
import type { UserFileImport, UserFileImportPage, WorkspaceCatalogueItem } from '@/api';
import { invalidateNodeWorkspaceQueries } from '@/features/workspace/common/hooks/workspaceMutationCache';
import { workspaceAnalysesQueryOptions } from '@/features/workspace/common/hooks/workspaceAnalysesQuery';
import { queryKeys } from '@/lib/queryKeys';
import { useFreshNodesStore } from '@/stores/freshNodesStore';
import { analysisToTask, importToTask, sortTasks, type TaskItem } from './taskProjection';
import {
  type BackendEvent,
  useWorkspaceTaskStreamClient,
  type WorkspaceTaskStreamClientState,
} from './useWorkspaceTaskStreamClient';

const IMPORT_PAGE_SIZE = 100;

const createsWorkspaceDataBlocks = (kind: string): boolean =>
  kind === 'concordance_match_data_block_creation' ||
  kind === 'concordance_document_data_block_creation' ||
  kind === 'quotation_result_data_block_creation' ||
  kind === 'topic_modeling_data_block_creation';

const nextPage = (page: { page: number; total_pages: number }): number | undefined =>
  page.page < page.total_pages ? page.page + 1 : undefined;

/** Reads the complete Task Inbox projection directly from paginated backend resources. */
export const useTaskResources = (workspaceId: string | null) => {
  const analysesQuery = useInfiniteQuery(workspaceAnalysesQueryOptions(workspaceId));

  const importsQuery = useInfiniteQuery({
    queryKey: queryKeys.userFileImports,
    queryFn: async ({ pageParam }): Promise<UserFileImportPage> => {
      const { data } = await listUserFileImports({
        query: { page: pageParam, page_size: IMPORT_PAGE_SIZE },
        throwOnError: true,
      });
      return data;
    },
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });
  const {
    fetchNextPage: fetchNextAnalysisPage,
    hasNextPage: hasNextAnalysisPage,
    isFetchingNextPage: isFetchingNextAnalysisPage,
  } = analysesQuery;
  const {
    fetchNextPage: fetchNextImportPage,
    hasNextPage: hasNextImportPage,
    isFetchingNextPage: isFetchingNextImportPage,
  } = importsQuery;

  useEffect(() => {
    if (hasNextAnalysisPage && !isFetchingNextAnalysisPage) {
      void fetchNextAnalysisPage();
    }
  }, [fetchNextAnalysisPage, hasNextAnalysisPage, isFetchingNextAnalysisPage]);

  useEffect(() => {
    if (hasNextImportPage && !isFetchingNextImportPage) {
      void fetchNextImportPage();
    }
  }, [fetchNextImportPage, hasNextImportPage, isFetchingNextImportPage]);

  const analyses = workspaceId
    ? (analysesQuery.data?.pages.flatMap((page) => page.items) ?? []).map((analysis) =>
        analysisToTask(analysis, workspaceId),
      )
    : [];
  const imports = (importsQuery.data?.pages.flatMap((page) => page.items) ?? []).map(importToTask);
  const error = analysesQuery.error ?? importsQuery.error;

  return {
    tasks: sortTasks([...analyses, ...imports]),
    error: error?.message ?? null,
  } as const;
};

export interface WorkspaceTaskInboxState extends WorkspaceTaskStreamClientState {
  tasks: TaskItem[];
  stopUserFileImport: (importId: string) => void;
  clearUserFileImport: (importId: string) => void;
  stoppingImportId: string | null;
  clearingImportId: string | null;
}

const replaceImportInPages = (
  previous: InfiniteData<UserFileImportPage> | undefined,
  resource: UserFileImport,
): InfiniteData<UserFileImportPage> | undefined =>
  previous
    ? {
        ...previous,
        pages: previous.pages.map((page) => ({
          ...page,
          items: page.items.map((item) => (item.id === resource.id ? resource : item)),
        })),
      }
    : previous;

/** Connects backend events to the same Query resources projected by the Task Inbox. */
export const useWorkspaceTaskInbox = (workspaceId: string | null): WorkspaceTaskInboxState => {
  const queryClient = useQueryClient();
  const { tasks, error: resourceError } = useTaskResources(workspaceId);

  const cancelImportMutation = useMutation({
    mutationFn: async (importId: string) => {
      const { data } = await cancelUserFileImport({
        path: { import_id: importId },
        throwOnError: true,
      });
      return data;
    },
    onSuccess: (resource) => {
      queryClient.setQueryData(queryKeys.userFileImport(resource.id), resource);
      queryClient.setQueryData<InfiniteData<UserFileImportPage>>(
        queryKeys.userFileImports,
        (previous) => replaceImportInPages(previous, resource),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.userFileImports });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not stop the file import.');
    },
  });

  const deleteImportMutation = useMutation({
    mutationFn: async (importId: string) => {
      await deleteUserFileImport({
        path: { import_id: importId },
        throwOnError: true,
      });
      return importId;
    },
    onSuccess: (importId) => {
      queryClient.removeQueries({ queryKey: queryKeys.userFileImport(importId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.userFileImports });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not clear the file import.');
    },
  });

  const refreshResource = useCallback(
    async (event: Extract<BackendEvent, { type: 'resource_changed' | 'resource_progress' }>) => {
      if (event.resource_type === 'analysis') {
        if (!workspaceId || event.workspace_id !== workspaceId) return;
        try {
          const { data } = await getAnalysis({
            path: { workspace_id: workspaceId, analysis_id: event.resource_id },
            throwOnError: true,
          });
          queryClient.setQueryData(queryKeys.analysis(workspaceId, event.resource_id), data);
          void queryClient.invalidateQueries({
            queryKey: queryKeys.workspaceAnalyses(workspaceId),
          });
          if (data.state === 'succeeded') {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.analysisResults(workspaceId, event.resource_id),
            });
            if (data.request.kind === 'annotation_run_all') {
              invalidateNodeWorkspaceQueries(
                queryClient,
                workspaceId,
                data.request.source.node_id,
                {
                  includeData: true,
                },
              );
            }
            if (createsWorkspaceDataBlocks(data.request.kind)) {
              useFreshNodesStore.getState().markCreated(workspaceId, data.output_node_ids);
            }
          }
        } catch (error) {
          console.warn('Could not refresh analysis activity', error);
        }
        return;
      }

      if (event.resource_type === 'user_file_import') {
        try {
          const { data } = await getUserFileImport({
            path: { import_id: event.resource_id },
            throwOnError: true,
          });
          queryClient.setQueryData(queryKeys.userFileImport(event.resource_id), data);
          void queryClient.invalidateQueries({ queryKey: queryKeys.userFileImports });
          if (data.state === 'succeeded') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.fileList, exact: true });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.sampleCollections,
              exact: true,
            });
          }
        } catch (error) {
          console.warn('Could not refresh user-file import activity', error);
        }
      }
    },
    [queryClient, workspaceId],
  );

  const removeResource = useCallback(
    (event: Extract<BackendEvent, { type: 'resource_removed' }>) => {
      if (event.resource_type === 'analysis') {
        if (!workspaceId || (event.workspace_id && event.workspace_id !== workspaceId)) return;
        queryClient.removeQueries({
          queryKey: queryKeys.analysisSession(workspaceId, event.resource_id),
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceAnalyses(workspaceId) });
      } else if (event.resource_type === 'user_file_import') {
        queryClient.removeQueries({ queryKey: queryKeys.userFileImport(event.resource_id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.userFileImports });
      }
    },
    [queryClient, workspaceId],
  );

  const handleEvent = useCallback(
    (event: BackendEvent) => {
      switch (event.type) {
        case 'stream_ready':
        case 'resync_required':
          void queryClient.invalidateQueries({ queryKey: queryKeys.userFileImports });
          void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceList, exact: true });
          if (workspaceId) {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.workspaceAnalyses(workspaceId),
            });
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTabs(workspaceId) });
          }
          break;
        case 'resource_changed':
        case 'resource_progress':
          void refreshResource(event);
          if (event.resource_type === 'tab' && workspaceId && event.workspace_id === workspaceId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTabs(workspaceId) });
          }
          if (event.resource_type === 'workspace') {
            void queryClient.invalidateQueries({
              queryKey: queryKeys.workspaceList,
              exact: true,
            });
            if (workspaceId && event.workspace_id === workspaceId) {
              void queryClient.invalidateQueries({
                queryKey: queryKeys.workspaceGraph(workspaceId),
              });
              void queryClient.invalidateQueries({
                queryKey: queryKeys.workspaceTabs(workspaceId),
              });
            }
          }
          break;
        case 'resource_removed':
          removeResource(event);
          if (event.resource_type === 'tab' && workspaceId && event.workspace_id === workspaceId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTabs(workspaceId) });
          }
          if (event.resource_type === 'workspace') {
            queryClient.setQueryData<WorkspaceCatalogueItem[]>(
              queryKeys.workspaceList,
              (previous) => previous?.filter((workspace) => workspace.id !== event.workspace_id),
            );
          }
          break;
        case 'workspace_runtime_changed':
          queryClient.setQueryData<WorkspaceCatalogueItem[]>(queryKeys.workspaceList, (previous) =>
            previous?.map((workspace) =>
              workspace.availability === 'available' && workspace.id === event.workspace_id
                ? { ...workspace, runtime_state: event.runtime_state }
                : workspace,
            ),
          );
          if (event.workspace_id === workspaceId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceTabs(workspaceId) });
          }
          break;
      }
    },
    [queryClient, refreshResource, removeResource, workspaceId],
  );

  const clientState = useWorkspaceTaskStreamClient({ enabled: true, onEvent: handleEvent });
  const lifecycleState = {
    stopUserFileImport: (importId: string) => {
      cancelImportMutation.mutate(importId);
    },
    clearUserFileImport: (importId: string) => {
      deleteImportMutation.mutate(importId);
    },
    stoppingImportId: cancelImportMutation.isPending ? cancelImportMutation.variables : null,
    clearingImportId: deleteImportMutation.isPending ? deleteImportMutation.variables : null,
  };
  return resourceError
    ? { ...clientState, ...lifecycleState, tasks, status: 'error', error: resourceError }
    : { ...clientState, ...lifecycleState, tasks };
};
