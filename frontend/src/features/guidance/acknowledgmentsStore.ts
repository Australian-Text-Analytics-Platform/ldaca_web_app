import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface GuidanceAcknowledgmentsState {
  byUser: Record<string, Record<string, number>>;
  acknowledge: (userId: string, hintId: string, version: number) => void;
  isAcknowledged: (userId: string, hintId: string, version: number) => boolean;
  reset: (userId: string) => void;
}

const LEGACY_ADD_TO_WORKSPACE_HINT_IDS = {
  'concordance.publish': 'concordance.add-to-workspace',
  'topic-modeling.publish': 'topic-modeling.add-to-workspace',
  'quotation.publish': 'quotation.add-to-workspace',
} as const;

interface PersistedGuidanceAcknowledgments {
  byUser?: Record<string, Record<string, number>>;
}

const migrateGuidanceAcknowledgments = (persistedState: unknown, version: number) => {
  const state = (persistedState ?? {}) as PersistedGuidanceAcknowledgments;
  if (version >= 1 || !state.byUser) return state;

  return {
    ...state,
    byUser: Object.fromEntries(
      Object.entries(state.byUser).map(([userId, acknowledgments]) => {
        const migrated = Object.fromEntries(
          Object.entries(acknowledgments).filter(
            ([hintId]) => !(hintId in LEGACY_ADD_TO_WORKSPACE_HINT_IDS),
          ),
        );
        for (const [legacyId, currentId] of Object.entries(LEGACY_ADD_TO_WORKSPACE_HINT_IDS)) {
          const legacyVersion = acknowledgments[legacyId];
          if (legacyVersion !== undefined) {
            migrated[currentId] = Math.max(migrated[currentId] ?? 0, legacyVersion);
          }
        }
        return [userId, migrated];
      }),
    ),
  };
};

export const useGuidanceAcknowledgmentsStore = create<GuidanceAcknowledgmentsState>()(
  persist(
    (set, get) => ({
      byUser: {},
      acknowledge: (userId, hintId, version) => {
        set((state) => ({
          byUser: {
            ...state.byUser,
            [userId]: {
              ...state.byUser[userId],
              [hintId]: Math.max(state.byUser[userId]?.[hintId] ?? 0, version),
            },
          },
        }));
      },
      isAcknowledged: (userId, hintId, version) => (get().byUser[userId]?.[hintId] ?? 0) >= version,
      reset: (userId) => {
        set((state) => {
          return {
            byUser: Object.fromEntries(
              Object.entries(state.byUser).filter(([candidate]) => candidate !== userId),
            ),
          };
        });
      },
    }),
    {
      name: 'wordflow-guidance-acknowledgments',
      version: 1,
      migrate: migrateGuidanceAcknowledgments,
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
);
