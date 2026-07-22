import { useCallback, useEffect } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { getAnalysis, getUserFileImport, listAnalyses, listUserFileImports } from '@/api';
import type { AnalysisPage, UserFileImportPage, WorkspaceResource } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { analysisToTask, importToTask, sortTasks, type TaskItem } from './taskProjection';
import {
  type BackendEvent,
  useWorkspaceTaskStreamClient,
  type WorkspaceTaskStreamClientState,
} from './useWorkspaceTaskStreamClient';

const ANALYSIS_PAGE_SIZE = 500;
const IMPORT_PAGE_SIZE = 100;

const nextPage = (page: { page: number; total_pages: number }): number | undefined =>
  page.page < page.total_pages ? page.page + 1 : undefined;

/** Reads the complete Task Inbox projection directly from paginated backend resources. */
export const useTaskResources = (workspaceId: string | null) => {
  const analysesQuery = useInfiniteQuery({
    queryKey: workspaceId ? queryKeys.workspaceAnalyses(workspaceId) : ['analyses', 'disabled'],
    queryFn: async ({ pageParam }): Promise<AnalysisPage> => {
      if (!workspaceId) throw new Error('Missing workspace ID');
      const { data } = await listAnalyses({
        path: { workspace_id: workspaceId },
        query: { page: pageParam, page_size: ANALYSIS_PAGE_SIZE },
        throwOnError: true,
      });
      return data;
    },
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled: Boolean(workspaceId),
  });

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
}

/** Connects backend events to the same Query resources projected by the Task Inbox. */
export const useWorkspaceTaskInbox = (workspaceId: string | null): WorkspaceTaskInboxState => {
  const queryClient = useQueryClient();
  const { tasks, error: resourceError } = useTaskResources(workspaceId);

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
            void queryClient.invalidateQueries({ queryKey: queryKeys.files });
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
          void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
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
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
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
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
          }
          break;
        case 'workspace_runtime_changed':
          queryClient.setQueryData<WorkspaceResource[]>(queryKeys.workspaces, (previous) =>
            previous?.map((workspace) =>
              workspace.id === event.workspace_id
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
  return resourceError
    ? { ...clientState, tasks, status: 'error', error: resourceError }
    : { ...clientState, tasks };
};
