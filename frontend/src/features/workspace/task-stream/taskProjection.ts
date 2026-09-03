import type {
  Analysis,
  UnavailableAnalysis,
  UnavailableUserFileImport,
  UserFileImport,
} from '@/api';

type TaskState = 'queued' | 'running' | 'successful' | 'failed' | 'cancelled';

interface TaskItemBase {
  task_id: string;
  task_type: string;
  name?: string;
  state: TaskState;
  progress?: number;
  progress_message?: string;
  message?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
}

interface AnalysisTaskItem extends TaskItemBase {
  resource_type: 'analysis';
  workspace_id: string;
  tab_id: string;
}

interface UserFileImportTaskItem extends TaskItemBase {
  resource_type: 'user_file_import';
}

export type TaskItem = AnalysisTaskItem | UserFileImportTaskItem;

const PENDING_TASK_STATES: ReadonlySet<string> = new Set(['queued']);
const RUNNING_TASK_STATES: ReadonlySet<string> = new Set(['running']);

export const isPendingTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && PENDING_TASK_STATES.has(state));

export const isRunningTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && RUNNING_TASK_STATES.has(state));

const toTaskState = (state: Analysis['state']): TaskState =>
  state === 'succeeded' ? 'successful' : state;

const failureMessage = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
};

export const analysisToTask = (
  resource: Analysis | UnavailableAnalysis,
  workspaceId: string,
): TaskItem => {
  if (resource.availability === 'available') {
    const progress = 'progress' in resource ? resource.progress : null;
    return {
      resource_type: 'analysis',
      task_id: resource.id,
      task_type: resource.request.kind,
      workspace_id: workspaceId,
      tab_id: resource.tab_id,
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
    resource_type: 'analysis',
    task_id: resource.id,
    task_type: 'analysis_unavailable',
    workspace_id: workspaceId,
    tab_id: resource.tab_id,
    state: 'failed',
    message: resource.warning,
    error: resource.reason,
  };
};

export const importToTask = (resource: UserFileImport | UnavailableUserFileImport): TaskItem => {
  if (resource.availability === 'unavailable') {
    return {
      resource_type: 'user_file_import',
      task_id: resource.id,
      task_type: 'user_file_import_unavailable',
      state: 'failed',
      message: resource.warning,
      error: resource.reason,
    };
  }
  const progress = resource.progress;
  return {
    resource_type: 'user_file_import',
    task_id: resource.id,
    task_type: resource.request.kind === 'sample' ? 'sample_import' : 'data_portal_import',
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

const taskTimestamp = (task: TaskItem): number => {
  const value = Date.parse(task.finished_at ?? task.started_at ?? task.created_at ?? '');
  return Number.isNaN(value) ? 0 : value;
};

export const sortTasks = (tasks: TaskItem[]): TaskItem[] =>
  tasks.toSorted((left, right) => taskTimestamp(right) - taskTimestamp(left));
