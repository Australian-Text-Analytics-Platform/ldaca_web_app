import { getTaskTypeCandidates } from '@/hooks/analysisTaskUtils';
import { isTerminalTaskState } from '@/stores/analysisStore';

export { isTerminalTaskState };

export interface ShouldRefreshOnCompletionInput {
  isTabActive: boolean;
  taskState: string | null | undefined;
  taskType: string;
  completedTaskType: string | null | undefined;
}

/**
 * Decides whether a task-center completion event belongs to the active analysis
 * tab, preventing background or unrelated task completions from refetching results.
 * Used by: useAnalysisTaskFlow terminal-task effect because only active tabs with matching terminal task types should refresh results.
 */
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

/**
 * Identifies task-center clear actions that should remove cached task metadata
 * without also resetting the analysis feature's visible parameter state.
 * Used by: task-center action handlers because clear-task-center-item removes task metadata without resetting visible analysis parameters.
 */
export const isTaskCenterClearOnlyAction = (action: string | null | undefined): boolean =>
  action === 'clear-task-center-item';