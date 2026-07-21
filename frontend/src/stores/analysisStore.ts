import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import type { ConcordanceAnalysisResponse } from '@/api';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';

/** Canonical task lifecycle states. */
type TaskState = 'queued' | 'running' | 'successful' | 'failed' | 'cancelled';

/** States representing work the backend has accepted but not started. */
const PENDING_TASK_STATES: ReadonlySet<string> = new Set<string>(['queued']);
/** State representing in-flight execution. */
const RUNNING_TASK_STATES: ReadonlySet<string> = new Set<string>(['running']);
/** States the task can never leave (i.e. polling can stop). */
const TERMINAL_TASK_STATES: ReadonlySet<string> = new Set<string>([
  'successful',
  'failed',
  'cancelled',
]);

/** Lets hooks treat accepted work as one queued bucket. */
/** Used by DataLoaderFeature and useAnalysisTaskStatus to classify accepted work consistently. */
export const isPendingTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && PENDING_TASK_STATES.has(state));
/** Lets task banners detect active worker execution. */
/** Used by DataLoaderFeature to keep the active-workspace refresh indicator visible. */
export const isRunningTaskState = (state: string | null | undefined): boolean =>
  Boolean(state && RUNNING_TASK_STATES.has(state));
/** Lets polling/result hooks stop watching states that cannot transition further. */
/** Used by task policies and useAnalysisTaskStatus to identify completed work. */
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
  targetTabId: string;
  result?: ConcordanceAnalysisResponse;
  source?: string;
  searchWord?: string;
  selectedNodes?: { id?: string; [key: string]: unknown }[];
  nodeColumnSelections?: NodeColumnSelection[];
  autoRun?: boolean;
  timestamp?: number;
}

interface AnalysisState {
  tasks: TaskItem[];
  pendingConcordance: PendingConcordance | null;
  setTasks: (tasks: TaskItem[] | ((prev: TaskItem[]) => TaskItem[])) => void;
  setPendingConcordance: (payload: PendingConcordance) => void;
  clearPendingConcordance: () => void;
}

export const useAnalysisStore = create<AnalysisState>()(
  immer((set) => ({
    tasks: [],
    pendingConcordance: null,
    /** Used by the task inbox and analysis features to merge or prune shared task summaries. */
    setTasks: (tasks) => {
      set((state) => {
        state.tasks = typeof tasks === 'function' ? tasks(state.tasks) : tasks;
      });
    },
    /** Used by Token Frequency to stage the payload consumed by Concordance's auto-run handoff. */
    setPendingConcordance: (payload) => {
      set((state) => {
        state.pendingConcordance = { ...payload, timestamp: payload.timestamp ?? Date.now() };
      });
    },
    /** Called by the Concordance handoff hook after it consumes the staged payload. */
    clearPendingConcordance: () => {
      set((state) => {
        state.pendingConcordance = null;
      });
    },
  })),
);
