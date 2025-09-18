import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import type { MultiNodeConcordanceResponse } from '../api/text'
import type { TokenFrequencyResponse } from '../api/text'

interface LockedNodeSnapshot {
  nodeId: string;
  name: string;
  columns: string[];
}

interface ConcordanceLockState {
  workspaceId: string | null
  locked: boolean
  lockedNodeIds: string[]
  lockedNodeColumns: Record<string, string>
  viewMode: 'separated' | 'combined'
  results: MultiNodeConcordanceResponse | null
  lockedNodesSnapshot: LockedNodeSnapshot[]
  lockedParams: {
    searchWord: string;
    numLeftTokens: number;
    numRightTokens: number;
    regex: boolean;
    caseSensitive: boolean;
    pageSize: number;
  }
}

interface LockedNodeSnapshot {
  nodeId: string;
  name: string;
  columns: string[];
}

interface TokenFreqLockState {
  workspaceId: string | null
  locked: boolean
  lockedNodeIds: string[]
  lockedNodeColumns: Record<string, string>
  results: TokenFrequencyResponse | null
  lockedNodesSnapshot: LockedNodeSnapshot[]
  lockedParams: {
    stopWords?: string[];
    limit?: number;
  }
}

interface QuotationLockState {
  workspaceId: string | null
  locked: boolean
  lockedNodeIds: string[]
  lockedNodeColumns: Record<string, string>
  results: any | null
  lockedNodesSnapshot: LockedNodeSnapshot[]
  lockedParams: {
    showMetadata?: boolean;
  }
}

interface TimelineLockState {
  workspaceId: string | null
  locked: boolean
  lockedNodeIds: string[]
  lockedNodeColumns: Record<string, string> // time column under node id
  results: any | null
  lockedNodesSnapshot: LockedNodeSnapshot[]
  lockedParams: {
    groupByColumns: string[]
    frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
    sortByTime: boolean
  }
}

interface TopicModelingLockState {
  workspaceId: string | null
  locked: boolean
  lockedNodeIds: string[]
  lockedNodeColumns: Record<string, string>
  results: any | null
  lockedNodesSnapshot: LockedNodeSnapshot[]
  lockedParams: {
    minTopicSize: number
    useCtTfidf: boolean
  }
}

interface TaskItem { 
  task_id: string; 
  task_type: string; 
  // Note: backend task polling may still send `status`; keeping both for transitional compatibility
  status?: 'running' | 'successful' | 'failed' | 'cancelled';
  state?: 'running' | 'successful' | 'failed' | 'cancelled';
  message?: string; 
  progress?: number; 
  progress_message?: string;
  updated_at?: number; 
  created_at?: number;
  started_at?: number;
  finished_at?: number | null;
  metadata?: any;
}

interface AnalysisStoreState {
  tasks: TaskItem[]
  concordance: ConcordanceLockState | null
  tokenFreq: TokenFreqLockState | null
  quotation: QuotationLockState | null
  timeline: TimelineLockState | null
  topicModeling: TopicModelingLockState | null
}

interface AnalysisStoreActions {
  setTasks: (tasks: TaskItem[] | ((prev: TaskItem[]) => TaskItem[])) => void
  clearTasks: () => void
  setConcordanceLock: (s: ConcordanceLockState) => void
  clearConcordance: () => void
  setTokenFreqLock: (s: TokenFreqLockState) => void
  clearTokenFreq: () => void
  setQuotationLock: (s: QuotationLockState) => void
  clearQuotation: () => void
  setTimelineLock: (s: TimelineLockState) => void
  clearTimeline: () => void
  setTopicModelingLock: (s: TopicModelingLockState) => void
  clearTopicModeling: () => void
}

export const useAnalysisStore = create<AnalysisStoreState & AnalysisStoreActions>()(
  devtools(
    immer((set) => ({
      tasks: [] as TaskItem[],
      concordance: null,
      tokenFreq: null,
      quotation: null,
      timeline: null,
      topicModeling: null,

      setTasks: (tasks) => set((state) => { 
        // Handle both array and updater function forms
        const nextTasks = typeof tasks === 'function' 
          ? (tasks as (prev: TaskItem[]) => TaskItem[])(state.tasks) 
          : tasks;
        state.tasks = nextTasks;
        // Dispatch event to notify components of task updates
        try {
          window.dispatchEvent(new CustomEvent('tasksUpdated', { detail: { tasks: nextTasks } }));
        } catch (e) {
          // Ignore errors (e.g., in test environments)
        }
      }),
      clearTasks: () => set((state) => { state.tasks = [] }),

      setConcordanceLock: (s) => set((state) => { state.concordance = s }),
      clearConcordance: () => set((state) => { state.concordance = null }),

      setTokenFreqLock: (s) => set((state) => { state.tokenFreq = s }),
      clearTokenFreq: () => set((state) => { state.tokenFreq = null }),

      setQuotationLock: (s) => set((state) => { state.quotation = s }),
      clearQuotation: () => set((state) => { state.quotation = null }),

      setTimelineLock: (s) => set((state) => { state.timeline = s }),
      clearTimeline: () => set((state) => { state.timeline = null }),

      setTopicModelingLock: (s) => set((state) => { state.topicModeling = s }),
      clearTopicModeling: () => set((state) => { state.topicModeling = null }),
    })),
    { name: 'analysis-store' }
  )
)

