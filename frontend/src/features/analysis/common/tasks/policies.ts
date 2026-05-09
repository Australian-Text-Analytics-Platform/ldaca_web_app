import { getTaskTypeCandidates } from '@/hooks/analysisTaskUtils';

const TERMINAL_STATES = new Set(['successful', 'failed', 'cancelled']);

export const isTerminalTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && TERMINAL_STATES.has(state));

export interface ShouldRefreshOnCompletionInput {
  isTabActive: boolean;
  taskState: string | null | undefined;
  taskType: string;
  completedTaskType: string | null | undefined;
}

export const shouldRefreshOnCompletion = ({
  isTabActive,
  taskState,
  taskType,
  completedTaskType,
}: ShouldRefreshOnCompletionInput): boolean => {
  if (!isTabActive) {
    return false;
  }

  if (!isTerminalTaskState(taskState)) {
    return false;
  }

  if (!completedTaskType) {
    return false;
  }

  const expectedTypes = new Set(getTaskTypeCandidates(taskType));
  return expectedTypes.has(completedTaskType);
};

export const isTaskCenterClearOnlyAction = (action: string | null | undefined): boolean =>
  action === 'clear-task-center-item';