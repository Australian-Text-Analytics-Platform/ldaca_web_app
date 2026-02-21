import { create } from 'zustand';

import type { ConcordanceResult } from '../api/models';

export interface TaskItem {
  task_id: string;
  task_type?: string;
  state?: 'pending' | 'running' | 'successful' | 'failed' | 'cancelled' | string;
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
  result?: ConcordanceResult;
  source?: string;
  searchWord?: string;
  selectedNodes?: Array<{ id?: string; [key: string]: unknown }>;
  nodeColumnSelections?: Array<Record<string, unknown>>;
  nodeColors?: Record<string, string>;
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

export const useAnalysisStore = create<AnalysisState>((set) => ({
  tasks: [],
  pendingConcordance: null,
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
}));

