import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { ConcordanceAnalysisResponse } from '@/api/generated/types.gen';
import type { NodeColumnSelection } from '@/features/workspace/common/hooks/useAutoNodeColumns';

/** Canonical task lifecycle states. */
export type TaskState =
  | 'pending'
  | 'queued'
  | 'submitted'
  | 'running'
  | 'successful'
  | 'failed'
  | 'cancelled';

/** States representing work the backend has accepted but not started. */
const PENDING_TASK_STATES: ReadonlySet<string> = new Set<string>([
  'pending',
  'queued',
  'submitted',
]);
/** States representing in-flight execution. */
const RUNNING_TASK_STATES: ReadonlySet<string> = new Set<string>(['running']);
/** States the task can never leave (i.e. polling can stop). */
const TERMINAL_TASK_STATES: ReadonlySet<string> = new Set<string>([
  'successful',
  'failed',
  'cancelled',
]);

/** Lets hooks treat queued/submitted variants as one pending bucket. */
/** Used by: src/features/views/data-loader/DataLoaderFeature.tsx, src/hooks/useAnalysisTaskStatus.ts because store consumers need the action and state contract documented at the mutation boundary. */
export const isPendingTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && PENDING_TASK_STATES.has(state));
/** Lets task banners detect active worker execution. */
/** Used by: src/features/views/data-loader/DataLoaderFeature.tsx because store consumers need the action and state contract documented at the mutation boundary. */
export const isRunningTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && RUNNING_TASK_STATES.has(state));
/** Lets polling/result hooks stop watching states that cannot transition further. */
/** Used by: src/features/views/common/tasks/policies.ts, src/hooks/useAnalysisTaskStatus.ts because store consumers need the action and state contract documented at the mutation boundary. */
export const isTerminalTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && TERMINAL_TASK_STATES.has(state));

export interface TaskItem {
  task_id: string;
  task_type?: string;
  name?: string;
  user_id?: string;
  workspace_id?: string;
  state?: TaskState;
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
  selectedNodes?: { id?: string; [key: string]: unknown }[];
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

export const useAnalysisStore = create<AnalysisState>()(
  immer((set) => ({
    tasks: [],
    pendingConcordance: null,
    materializedEvents: [],
    /** Replaces or updates task summaries received from polling/SSE task streams. */
    /** Consumed by: useAnalysisStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    setTasks: (tasks) =>
      { set((state) => {
        state.tasks = typeof tasks === 'function' ? tasks(state.tasks) : tasks;
      }); },
    /** Stores the concordance payload that should be consumed after an auto-run handoff. */
    /** Consumed by: useAnalysisStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    setPendingConcordance: (payload) =>
      { set((state) => {
        state.pendingConcordance = { ...payload, timestamp: payload.timestamp ?? Date.now() };
      }); },
    /** Clears the concordance handoff once the destination feature consumes it. */
    /** Consumed by: useAnalysisStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    clearPendingConcordance: () =>
      { set((state) => {
        state.pendingConcordance = null;
      }); },
    /** Records worker materialization events so feature tabs can react without refetch races. */
    /** Consumed by: useAnalysisStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
    pushMaterializedEvent: (event) =>
      { set((state) => {
        materializedEventSequence += 1;
        state.materializedEvents.unshift({
          ...event,
          sequence: materializedEventSequence,
        });
        if (state.materializedEvents.length > MATERIALIZED_EVENT_HISTORY_LIMIT) {
          state.materializedEvents.length = MATERIALIZED_EVENT_HISTORY_LIMIT;
        }
      }); },
  })),
);
