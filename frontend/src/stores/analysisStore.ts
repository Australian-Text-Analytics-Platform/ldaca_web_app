import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

export interface TaskItem { 
  task_id: string; 
  task_type: string; 
  state?: 'running' | 'successful' | 'failed' | 'cancelled';
  message?: string; 
  progress?: number; 
  progress_message?: string;
  updated_at?: number; 
  created_at?: number;
  started_at?: number;
  finished_at?: number | null;
  metadata?: any;
  result_persisted?: boolean;
}

interface ConcordancePendingSearch {
  searchWord: string;
  nodeColumnSelections: Array<{ nodeId: string; column: string }>;
  selectedNodes: Array<{ id: string; name: string }>;
  nodeColors: Record<string, string>;
  autoRun?: boolean;
  timestamp: number;
}

interface AnalysisStoreState {
  tasks: TaskItem[]
  topicModelingReadyTaskId: string | null
  topicModelingReadyTimestamp: number | null
  pendingConcordance: ConcordancePendingSearch | null
}

interface AnalysisStoreActions {
  setTasks: (tasks: TaskItem[] | ((prev: TaskItem[]) => TaskItem[])) => void
  clearTasks: () => void
  markTopicModelingReady: (taskId: string, timestamp?: number | null) => void
  resetTopicModelingReady: () => void
  setPendingConcordance: (payload: ConcordancePendingSearch) => void
  clearPendingConcordance: () => void
}

export const useAnalysisStore = create<AnalysisStoreState & AnalysisStoreActions>()(
  devtools(
    immer((set) => ({
      tasks: [] as TaskItem[],
      topicModelingReadyTaskId: null,
      topicModelingReadyTimestamp: null,
      pendingConcordance: null,

      setTasks: (tasks) => set((state) => { 
        // Handle both array and updater function forms
        const nextTasks = typeof tasks === 'function' 
          ? (tasks as (prev: TaskItem[]) => TaskItem[])(state.tasks) 
          : tasks;
        state.tasks = nextTasks;
      }),
      clearTasks: () => set((state) => { state.tasks = [] }),

      markTopicModelingReady: (taskId, timestamp = null) => set((state) => {
        state.topicModelingReadyTaskId = taskId;
        state.topicModelingReadyTimestamp = timestamp ?? Date.now();
      }),
      resetTopicModelingReady: () => set((state) => {
        state.topicModelingReadyTaskId = null;
        state.topicModelingReadyTimestamp = null;
      }),

      setPendingConcordance: (payload) => set((state) => {
        state.pendingConcordance = payload;
      }),
      clearPendingConcordance: () => set((state) => {
        state.pendingConcordance = null;
      }),
    })),
    { name: 'analysis-store' }
  )
)

