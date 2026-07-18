import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface GuidanceAcknowledgmentsState {
  byUser: Record<string, Record<string, number>>;
  acknowledge: (userId: string, hintId: string, version: number) => void;
  isAcknowledged: (userId: string, hintId: string, version: number) => boolean;
  reset: (userId: string) => void;
}

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
      partialize: (state) => ({ byUser: state.byUser }),
    },
  ),
);
