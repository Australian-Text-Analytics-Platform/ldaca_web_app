import type { TaskItem } from '@/stores/analysisStore';
import type { AnalysisTaskStatus } from '@/features/views/common/useAnalysisTaskStatus';
import type { CanonicalAnalysisTaskType } from '../analysisIds';

export type { CanonicalAnalysisTaskType };

export interface NodePaginationState {
  currentPage: number;
  pageSize: number;
  sortBy?: string;
  descending: boolean;
}

export interface AnalysisTaskFlowRefreshContext {
  reason: 'terminal';
  task: TaskItem | null;
  taskId: string | null;
  taskState: TaskItem['state'] | null;
}

export interface AnalysisTaskBannerState {
  status: 'running' | 'queued';
  taskId: string | null;
  message?: string;
}

export interface AnalysisTaskBannerFallback {
  taskId?: string | null;
  message?: string;
}

type AnalysisTaskBannerFallbackInput =
  | AnalysisTaskBannerFallback
  | null
  | ((status: AnalysisTaskStatus) => AnalysisTaskBannerFallback | null);

export interface UseAnalysisTaskFlowOptions {
  taskType: CanonicalAnalysisTaskType | (string & {});
  isTabActive?: boolean;
  workspaceId?: string | null;
  /** Explicit ids owned by a tab. Omit only for workspace/type-scoped flows. */
  taskIds?: readonly string[];
  manualActiveTaskId?: string | null;
  fallbackRunningBanner?: AnalysisTaskBannerFallbackInput;
  refreshResults?: (context: AnalysisTaskFlowRefreshContext) => Promise<void> | void;
}

export interface UseAnalysisTaskFlowResult {
  status: AnalysisTaskStatus;
  banner: AnalysisTaskBannerState | null;
  waitingBanner: AnalysisTaskBannerState | null;
  activeTaskId: string | null;
  hasActiveTask: boolean;
  refreshNow: (reason?: AnalysisTaskFlowRefreshContext['reason']) => Promise<void> | void;
}
