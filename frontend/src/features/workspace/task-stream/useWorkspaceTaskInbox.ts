import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAnalysis, getUserFileImport, listAnalyses, listUserFileImports } from '@/api';
import type { Analysis, CorruptAnalysis, UserFileImport } from '@/api';
import { useAnalysisStore } from '@/stores/analysisStore';
import { queryKeys } from '@/lib/queryKeys';
import type { TaskItem } from '@/stores/analysisStore';
import {
  type BackendEvent,
  useWorkspaceTaskStreamClient,
  type WorkspaceTaskStreamClientState,
} from './useWorkspaceTaskStreamClient';

const toTaskState = (state: Analysis['state']): TaskItem['state'] =>
  state === 'succeeded' ? 'successful' : state;

const failureMessage = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
};

const toTaskItem = (
  resource: Analysis | CorruptAnalysis | UserFileImport,
  workspaceId?: string,
): TaskItem => {
  if ('request' in resource) {
    const kind = resource.request.kind;
    const progress = 'progress' in resource ? resource.progress : null;
    return {
      task_id: resource.id,
      task_type: kind,
      workspace_id: workspaceId,
      state: toTaskState(resource.state),
      progress: progress?.fraction ?? undefined,
      progress_message: progress?.message ?? undefined,
      message: failureMessage(resource.error) ?? progress?.message ?? undefined,
      created_at: resource.created_at,
      started_at: resource.started_at,
      finished_at: resource.finished_at,
      error: failureMessage(resource.error) ?? null,
    };
  }

  return {
    task_id: resource.id,
    task_type: 'analysis_corrupt',
    workspace_id: workspaceId,
    state: 'failed',
    message: 'This analysis record is corrupt and must be cleared.',
    error: resource.code ?? 'analysis_corrupt',
  };
};

const toImportTask = (resource: UserFileImport): TaskItem => {
  const progress = resource.progress;
  const taskType = resource.request.kind === 'sample' ? 'sample_import' : 'data_portal_import';
  return {
    task_id: resource.id,
    task_type: taskType,
    state: toTaskState(resource.state),
    progress: progress.fraction ?? undefined,
    progress_message: progress.message ?? undefined,
    message: failureMessage(resource.error) ?? progress.message ?? undefined,
    created_at: resource.created_at,
    started_at: resource.started_at,
    finished_at: resource.finished_at,
    error: failureMessage(resource.error) ?? null,
  };
};

const upsertTask = (task: TaskItem, previous: TaskItem[]): TaskItem[] => {
  const next = previous.filter((entry) => entry.task_id !== task.task_id);
  return [task, ...next].sort((left, right) => {
    const leftTime = Date.parse(left.finished_at ?? left.started_at ?? left.created_at ?? '');
    const rightTime = Date.parse(right.finished_at ?? right.started_at ?? right.created_at ?? '');
    return rightTime - leftTime;
  });
};

/** Rebuilds the task projection from authoritative resources after stream ready/resync. */
const loadTasks = async (workspaceId: string | null): Promise<TaskItem[]> => {
  const [importsResponse, analysesResponse] = await Promise.all([
    listUserFileImports({ query: { page: 1, page_size: 100 }, throwOnError: true }),
    workspaceId
      ? listAnalyses({
          path: { workspace_id: workspaceId },
          query: { page: 1, page_size: 500 },
          throwOnError: true,
        })
      : Promise.resolve(null),
  ]);
  const imports = importsResponse.data.items.map(toImportTask);
  const analyses = analysesResponse
    ? analysesResponse.data.items.map((analysis) => toTaskItem(analysis, workspaceId ?? undefined))
    : [];
  return [...imports, ...analyses];
};

/** Connects authoritative analysis/import resources to the shared activity UI. */
export const useWorkspaceTaskInbox = (
  workspaceId: string | null,
): WorkspaceTaskStreamClientState => {
  const queryClient = useQueryClient();
  const setTasks = useAnalysisStore((state) => state.setTasks);
  const [transientError, setTransientError] = useState<string | null>(null);

  const refreshTasks = useCallback(async () => {
    try {
      const tasks = await loadTasks(workspaceId);
      setTasks(tasks);
      setTransientError(null);
    } catch (error) {
      setTransientError(error instanceof Error ? error.message : 'Could not refresh activity');
    }
  }, [setTasks, workspaceId]);

  const refreshResource = useCallback(
    async (event: Extract<BackendEvent, { type: 'resource_changed' | 'resource_progress' }>) => {
      if (event.resource_type === 'analysis') {
        if (!workspaceId || event.workspace_id !== workspaceId) return;
        try {
          const { data } = await getAnalysis({
            path: { workspace_id: workspaceId, analysis_id: event.resource_id },
            throwOnError: true,
          });
          setTasks((previous) => upsertTask(toTaskItem(data, workspaceId), previous));
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
          setTasks((previous) => upsertTask(toImportTask(data), previous));
          if (data.state === 'succeeded') {
            void queryClient.invalidateQueries({ queryKey: queryKeys.files });
          }
        } catch (error) {
          console.warn('Could not refresh user-file import activity', error);
        }
      }
    },
    [queryClient, setTasks, workspaceId],
  );

  const removeResource = useCallback(
    (event: Extract<BackendEvent, { type: 'resource_removed' }>) => {
      if (
        event.resource_type === 'analysis' &&
        workspaceId &&
        event.workspace_id !== null &&
        event.workspace_id !== workspaceId
      ) {
        return;
      }
      setTasks((previous) => previous.filter((task) => task.task_id !== event.resource_id));
    },
    [setTasks, workspaceId],
  );

  const handleEvent = useCallback(
    (event: BackendEvent) => {
      switch (event.type) {
        case 'stream_ready':
        case 'resync_required':
          void refreshTasks();
          break;
        case 'resource_changed':
        case 'resource_progress':
          void refreshResource(event);
          if (
            event.resource_type === 'workspace' &&
            workspaceId &&
            event.workspace_id === workspaceId
          ) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(workspaceId) });
          }
          break;
        case 'resource_removed':
          removeResource(event);
          if (event.resource_type === 'workspace' && event.workspace_id === workspaceId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
          }
          break;
        case 'workspace_runtime_changed':
          if (event.workspace_id === workspaceId) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(workspaceId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(workspaceId) });
          }
          break;
      }
    },
    [queryClient, refreshResource, refreshTasks, removeResource, workspaceId],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- Initial synchronization hydrates the store from the backend resource list. */
  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const clientState = useWorkspaceTaskStreamClient({ enabled: true, onEvent: handleEvent });
  return transientError ? { ...clientState, status: 'error', error: transientError } : clientState;
};
