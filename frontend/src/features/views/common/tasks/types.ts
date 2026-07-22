import type { TaskItem } from '@/features/workspace/task-stream/taskProjection';
import type { CanonicalAnalysisTaskType } from '../analysisIds';

export type { CanonicalAnalysisTaskType };

export interface NodePaginationState {
  currentPage: number;
  pageSize: number;
  sortBy?: string;
  descending: boolean;
}

export interface AnalysisTaskBannerState {
  status: 'running' | 'queued';
  taskId: string | null;
  message?: string;
}

export interface AnalysisTaskStatus {
  tasks: TaskItem[];
  runningTask: TaskItem | null;
  queuedTask: TaskItem | null;
  successfulTask: TaskItem | null;
  failedTask: TaskItem | null;
  cancelledTask: TaskItem | null;
  terminalTask: TaskItem | null;
  activeTaskId: string | null;
  bannerStatus: 'running' | 'queued' | null;
  bannerTaskId: string | null;
  bannerMessage?: string;
}
