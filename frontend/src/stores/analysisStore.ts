import { create } from 'zustand';

import type { ConcordanceAnalysisResponse } from '../api/text';
import type { NodeColumnSelection } from '../hooks/useAutoNodeColumns';

/**
 * Canonical task lifecycle states. Backend may add string variants (e.g.
 * 'submitted'); the union widens with `string` to preserve forward-compat.
 */
export type TaskState =
  | 'pending'
  | 'queued'
  | 'submitted'
  | 'running'
  | 'successful'
  | 'failed'
  | 'cancelled';

/** States representing work the backend has accepted but not started. */
export const PENDING_TASK_STATES: ReadonlySet<string> = new Set<string>(['pending', 'queued', 'submitted']);
/** States representing in-flight execution. */
export const RUNNING_TASK_STATES: ReadonlySet<string> = new Set<string>(['running']);
/** States the task can never leave (i.e. polling can stop). */
export const TERMINAL_TASK_STATES: ReadonlySet<string> = new Set<string>(['successful', 'failed', 'cancelled']);

export const isPendingTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && PENDING_TASK_STATES.has(state));
export const isRunningTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && RUNNING_TASK_STATES.has(state));
export const isTerminalTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && TERMINAL_TASK_STATES.has(state));

export interface TaskItem {
  task_id: string;
  task_type?: string;
  name?: string;
  user_id?: string;
  workspace_id?: string;
  state?: TaskState | string;
  progress?: number;
  message?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface PendingConcordance {
  result?: ConcordanceAnalysisResponse;
  source?: string;
  searchWord?: string;
  selectedNodes?: Array<{ id?: string; [key: string]: unknown }>;
  nodeColumnSelections?: NodeColumnSelection[];
  nodeColors?: Record<string, string>;
  autoRun?: boolean;
  timestamp?: number;
}

/**
 * Mirror of the backend's `analysis_materialized` SSE event. Pushed onto the
 * store the moment the worker emits it, so feature components can react
 * synchronously without having to refetch the parent task's request (which
 * races with the persistence write on the backend).
 */
export interface AnalysisMaterializedEvent {
  taskType: string;
  taskId: string;
  parentTaskId: string;
  parentNodeId: string;
  materializedPath: string;
  timestamp: number;
  /** Monotonically increasing sequence to disambiguate equal timestamps. */
  sequence: number;
}

interface AnalysisState {
  tasks: TaskItem[];
  pendingConcordance: PendingConcordance | null;
  /**
   * Latest `analysis_materialized` notifications, newest first. Bounded length
   * (`MATERIALIZED_EVENT_HISTORY_LIMIT`) — consumers should look up by
   * `parentTaskId` + `parentNodeId` rather than scan the array.
   */
  materializedEvents: AnalysisMaterializedEvent[];
  setTasks: (tasks: TaskItem[] | ((prev: TaskItem[]) => TaskItem[])) => void;
  setPendingConcordance: (payload: PendingConcordance) => void;
  clearPendingConcordance: () => void;
  pushMaterializedEvent: (event: Omit<AnalysisMaterializedEvent, 'sequence'>) => void;
}

const MATERIALIZED_EVENT_HISTORY_LIMIT = 64;
let materializedEventSequence = 0;

export const useAnalysisStore = create<AnalysisState>((set) => ({
  tasks: [],
  pendingConcordance: null,
  materializedEvents: [],
  setTasks: (tasks) =>
    set((state) => ({
      tasks: typeof tasks === 'function' ? tasks(state.tasks) : tasks,
    })),
  setPendingConcordance: (payload) =>
    set(() => ({
      pendingConcordance: {
        ...payload,
        timestamp: payload.timestamp ?? Date.now(),
      },
    })),
  clearPendingConcordance: () =>
    set(() => ({
      pendingConcordance: null,
    })),
  pushMaterializedEvent: (event) =>
    set((state) => {
      materializedEventSequence += 1;
      const next: AnalysisMaterializedEvent = {
        ...event,
        sequence: materializedEventSequence,
      };
      const merged = [next, ...state.materializedEvents].slice(
        0,
        MATERIALIZED_EVENT_HISTORY_LIMIT,
      );
      return { materializedEvents: merged };
    }),
}));

