import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface AnalysisTabsPresentationState {
  /** Last active Tab ID keyed by Workspace and analysis kind. */
  activeTabIds: Record<string, string>;
}

interface AnalysisTabsPresentationActions {
  rememberActiveTab: (
    workspaceId: string | null | undefined,
    analysisType: string,
    tabId: string | null,
  ) => void;
}

type AnalysisTabsPresentationStore = AnalysisTabsPresentationState &
  AnalysisTabsPresentationActions;

export const analysisTabsPresentationKey = (
  workspaceId: string | null | undefined,
  analysisType: string,
): string => `${workspaceId ?? '__none__'}::${analysisType}`;

/**
 * Device-local active-tab memory. Tab identity and content remain backend
 * resources; this store remembers only which valid Tab the client last showed.
 */
export const useAnalysisTabsPresentationStore = create<AnalysisTabsPresentationStore>()(
  devtools(
    persist(
      immer((set) => ({
        activeTabIds: {},

        rememberActiveTab: (workspaceId, analysisType, tabId) =>
          set((state) => {
            if (!workspaceId) return;
            const key = analysisTabsPresentationKey(workspaceId, analysisType);
            if (tabId) {
              state.activeTabIds[key] = tabId;
            } else {
              state.activeTabIds = Object.fromEntries(
                Object.entries(state.activeTabIds).filter(([storedKey]) => storedKey !== key),
              );
            }
          }),
      })),
      {
        name: 'ldaca-analysis-active-tabs',
        partialize: (state) => ({ activeTabIds: state.activeTabIds }),
      },
    ),
    { name: 'analysis-tabs-presentation-store' },
  ),
);
