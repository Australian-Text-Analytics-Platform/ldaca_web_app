/** Device-local state that is not synchronized as an account preference. */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface DevicePreferencesState {
  userId: string | null;
  lastWorkspaceId: string | null;
}

interface DevicePreferencesActions {
  setUser: (userId: string | null) => void;
  setLastWorkspaceId: (workspaceId: string | null) => void;
}

type DevicePreferencesStore = DevicePreferencesState & DevicePreferencesActions;

const defaults = (): DevicePreferencesState => ({
  userId: null,
  lastWorkspaceId: null,
});

export const useDevicePreferencesStore = create<DevicePreferencesStore>()(
  persist(
    (set, get) => ({
      ...defaults(),

      setUser: (userId) => {
        if (get().userId === userId) return;
        set({ ...defaults(), userId });
      },

      setLastWorkspaceId: (workspaceId) => set({ lastWorkspaceId: workspaceId }),
    }),
    {
      name: 'wordflow-device-preferences',
      partialize: (state) => ({
        userId: state.userId,
        lastWorkspaceId: state.lastWorkspaceId,
      }),
    },
  ),
);
