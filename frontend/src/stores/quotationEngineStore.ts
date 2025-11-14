import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { QuotationEngineConfig } from '@/api/text';

interface QuotationEngineDialogState {
  isOpen: boolean;
  setOpen: (isOpen: boolean) => void;
  open: () => void;
  close: () => void;
}

export const useQuotationEngineDialogStore = create<QuotationEngineDialogState>((set) => ({
  isOpen: false,
  setOpen: (isOpen) => set({ isOpen }),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));

interface QuotationEngineConfigState {
  config: QuotationEngineConfig;
  lastRemoteUrl: string;
  setConfig: (config: QuotationEngineConfig) => void;
  updateRemoteUrl: (url: string) => void;
  reset: () => void;
}

const storage = typeof window !== 'undefined'
  ? createJSONStorage<QuotationEngineConfigState>(() => window.localStorage)
  : undefined;

export const useQuotationEngineConfigStore = create(
  persist<QuotationEngineConfigState>(
    (set) => ({
      config: { type: 'local' },
      lastRemoteUrl: '',
      setConfig: (config) => set((state) => {
        if (config.type === 'local') {
          if (state.config.type === 'local') {
            return state;
          }
          return { ...state, config: { type: 'local' } };
        }

        const rawUrl = config.url ?? state.lastRemoteUrl ?? '';
        const nextUrl = rawUrl.trim();
        if (state.config.type === 'remote' && state.config.url === nextUrl && state.lastRemoteUrl === nextUrl) {
          return state;
        }
        return {
          ...state,
          config: { type: 'remote', url: nextUrl },
          lastRemoteUrl: nextUrl,
        };
      }),
      updateRemoteUrl: (url) => set((state) => {
        const nextUrl = url.trim();
        if (state.lastRemoteUrl === nextUrl && (state.config.type !== 'remote' || state.config.url === nextUrl)) {
          return state;
        }
        if (state.config.type === 'remote') {
          return {
            ...state,
            config: { type: 'remote', url: nextUrl },
            lastRemoteUrl: nextUrl,
          };
        }
        return {
          ...state,
          lastRemoteUrl: nextUrl,
        };
      }),
      reset: () => set({ config: { type: 'local' }, lastRemoteUrl: '' }),
    }),
    {
      name: 'ldaca.quotation.engine',
      storage,
      skipHydration: typeof window === 'undefined',
      version: 1,
    }
  )
);
