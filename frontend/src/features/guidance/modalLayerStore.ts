import { create } from 'zustand';

interface ModalLayerState {
  count: number;
  mounted: () => void;
  unmounted: () => void;
}

export const useModalLayerStore = create<ModalLayerState>((set) => ({
  count: 0,
  mounted: () => {
    set((state) => ({ count: state.count + 1 }));
  },
  unmounted: () => {
    set((state) => ({ count: Math.max(0, state.count - 1) }));
  },
}));
