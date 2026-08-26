import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { migrateLegacyAnnotationTabSettings } from '@/features/views/annotation/annotationTabSettings';

export const ANALYSIS_TABS_PRESENTATION_STORAGE_KEY = 'ldaca-analysis-tab-presentation-v4';
const LEGACY_ANALYSIS_TABS_PRESENTATION_STORAGE_KEY = 'ldaca-analysis-tab-presentation-v3';

interface PersistedPresentationState {
  state?: {
    activeTabIds?: Record<string, string>;
    tabSettings?: Record<string, Record<string, string>>;
  };
  version?: number;
}

/** Moves the prior device-local store once and consolidates Annotation settings. */
export const migrateAnalysisTabsPresentationV3 = (storage: Storage): void => {
  if (storage.getItem(ANALYSIS_TABS_PRESENTATION_STORAGE_KEY)) {
    storage.removeItem(LEGACY_ANALYSIS_TABS_PRESENTATION_STORAGE_KEY);
    return;
  }
  const legacyValue = storage.getItem(LEGACY_ANALYSIS_TABS_PRESENTATION_STORAGE_KEY);
  if (!legacyValue) return;
  try {
    const persisted = JSON.parse(legacyValue) as PersistedPresentationState;
    const tabSettings = Object.fromEntries(
      Object.entries(persisted.state?.tabSettings ?? {}).map(([key, settings]) => [
        key,
        migrateLegacyAnnotationTabSettings(settings),
      ]),
    );
    storage.setItem(
      ANALYSIS_TABS_PRESENTATION_STORAGE_KEY,
      JSON.stringify({
        ...persisted,
        state: { ...persisted.state, tabSettings },
        version: 4,
      }),
    );
    storage.removeItem(LEGACY_ANALYSIS_TABS_PRESENTATION_STORAGE_KEY);
  } catch (error) {
    console.warn('[analysis-tabs] Could not migrate v3 presentation settings:', error);
  }
};

if (typeof localStorage !== 'undefined') {
  migrateAnalysisTabsPresentationV3(localStorage);
}

interface AnalysisTabsPresentationState {
  /** Last active Tab ID keyed by user, Workspace, and analysis kind. */
  activeTabIds: Record<string, string>;
  /** Client-only presentation settings keyed by user, Workspace, and Tab. */
  tabSettings: Record<string, Record<string, string>>;
}

interface AnalysisTabsPresentationActions {
  rememberActiveTab: (
    userId: string | null | undefined,
    workspaceId: string | null | undefined,
    analysisType: string,
    tabId: string | null,
  ) => void;
  rememberTabSetting: (
    userId: string | null | undefined,
    workspaceId: string | null | undefined,
    tabId: string,
    key: string,
    value: string,
  ) => void;
  forgetTabSettings: (
    userId: string | null | undefined,
    workspaceId: string | null | undefined,
    tabId: string,
  ) => void;
  pruneWorkspaces: (userId: string, workspaceIds: readonly string[]) => void;
  pruneTabs: (userId: string, workspaceId: string, tabIds: readonly string[]) => void;
}

type AnalysisTabsPresentationStore = AnalysisTabsPresentationState &
  AnalysisTabsPresentationActions;

export const analysisTabsPresentationKey = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  analysisType: string,
): string => `${userId ?? '__anonymous__'}::${workspaceId ?? '__none__'}::${analysisType}`;

export const analysisTabSettingsKey = (
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  tabId: string,
): string => `${userId ?? '__anonymous__'}::${workspaceId ?? '__none__'}::${tabId}`;

/**
 * Device-local analysis presentation memory. Tab identity, Analysis ownership,
 * requests, and Results remain backend resources; only the active Tab and
 * post-run presentation controls live here.
 */
export const useAnalysisTabsPresentationStore = create<AnalysisTabsPresentationStore>()(
  devtools(
    persist(
      immer((set) => ({
        activeTabIds: {},
        tabSettings: {},

        rememberActiveTab: (userId, workspaceId, analysisType, tabId) =>
          set((state) => {
            if (!workspaceId) return;
            const key = analysisTabsPresentationKey(userId, workspaceId, analysisType);
            if (tabId) {
              state.activeTabIds[key] = tabId;
            } else {
              state.activeTabIds = Object.fromEntries(
                Object.entries(state.activeTabIds).filter(([storedKey]) => storedKey !== key),
              );
            }
          }),

        rememberTabSetting: (userId, workspaceId, tabId, key, value) =>
          set((state) => {
            if (!workspaceId) return;
            const settingsKey = analysisTabSettingsKey(userId, workspaceId, tabId);
            state.tabSettings[settingsKey] = {
              ...(state.tabSettings[settingsKey] ?? {}),
              [key]: value,
            };
          }),

        forgetTabSettings: (userId, workspaceId, tabId) =>
          set((state) => {
            if (!workspaceId) return;
            const settingsKey = analysisTabSettingsKey(userId, workspaceId, tabId);
            state.tabSettings = Object.fromEntries(
              Object.entries(state.tabSettings).filter(([storedKey]) => storedKey !== settingsKey),
            );
          }),

        pruneWorkspaces: (userId, workspaceIds) =>
          set((state) => {
            const valid = new Set(workspaceIds);
            const keepWorkspaceKey = (storedKey: string) => {
              if (!storedKey.startsWith(`${userId}::`)) return true;
              const workspaceId = storedKey.split('::')[1];
              return workspaceId ? valid.has(workspaceId) : false;
            };
            state.activeTabIds = Object.fromEntries(
              Object.entries(state.activeTabIds).filter(([storedKey]) =>
                keepWorkspaceKey(storedKey),
              ),
            );
            state.tabSettings = Object.fromEntries(
              Object.entries(state.tabSettings).filter(([storedKey]) =>
                keepWorkspaceKey(storedKey),
              ),
            );
          }),

        pruneTabs: (userId, workspaceId, tabIds) =>
          set((state) => {
            const valid = new Set(tabIds);
            const prefix = `${userId}::${workspaceId}::`;
            state.activeTabIds = Object.fromEntries(
              Object.entries(state.activeTabIds).filter(
                ([storedKey, tabId]) => !storedKey.startsWith(prefix) || valid.has(tabId),
              ),
            );
            state.tabSettings = Object.fromEntries(
              Object.entries(state.tabSettings).filter(([storedKey]) => {
                if (!storedKey.startsWith(prefix)) return true;
                const tabId = storedKey.slice(prefix.length);
                return valid.has(tabId);
              }),
            );
          }),
      })),
      {
        name: ANALYSIS_TABS_PRESENTATION_STORAGE_KEY,
        version: 4,
        partialize: (state) => ({
          activeTabIds: state.activeTabIds,
          tabSettings: state.tabSettings,
        }),
      },
    ),
    { name: 'analysis-tabs-presentation-store' },
  ),
);
