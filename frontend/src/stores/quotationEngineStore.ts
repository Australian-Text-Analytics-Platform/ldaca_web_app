import { create } from 'zustand';
import type { QuotationEngineConfig } from '@/api/text';
import { usePreferencesStore } from './preferencesStore';

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

/**
 * Quotation engine config store — now delegates to the preferences store for
 * persistence. The old `ldaca.quotation.engine` localStorage key is kept for
 * one-time migration but all future writes go through preferencesStore.
 */
export const useQuotationEngineConfigStore = create<QuotationEngineConfigState>()(
  (set) => {
    // Attempt one-time migration from old localStorage key
    try {
      const oldRaw = typeof window !== 'undefined'
        ? window.localStorage.getItem('ldaca.quotation.engine')
        : null;
      if (oldRaw) {
        const parsed = JSON.parse(oldRaw);
        const oldConfig = parsed?.state?.config as QuotationEngineConfig | undefined;
        const oldUrl = (parsed?.state?.lastRemoteUrl as string) ?? '';
        if (oldConfig) {
          const prefs = usePreferencesStore.getState();
          prefs.setQuotationEngine(oldConfig);
          if (oldUrl) prefs.setQuotationLastRemoteUrl(oldUrl);
        }
        window.localStorage.removeItem('ldaca.quotation.engine');
      }
    } catch {
      // Ignore migration errors
    }

    return {
      get config() {
        return usePreferencesStore.getState().quotationEngine;
      },
      get lastRemoteUrl() {
        return usePreferencesStore.getState().quotationLastRemoteUrl;
      },
      setConfig: (config) => {
        const prefs = usePreferencesStore.getState();
        if (config.type === 'local') {
          prefs.setQuotationEngine({ type: 'local' });
        } else {
          const rawUrl = config.url ?? prefs.quotationLastRemoteUrl ?? '';
          const nextUrl = rawUrl.trim();
          prefs.setQuotationEngine({ type: 'remote', url: nextUrl });
          prefs.setQuotationLastRemoteUrl(nextUrl);
        }
        // Update local Zustand state so subscribers re-render
        set({
          config: usePreferencesStore.getState().quotationEngine,
          lastRemoteUrl: usePreferencesStore.getState().quotationLastRemoteUrl,
        });
      },
      updateRemoteUrl: (url) => {
        const nextUrl = url.trim();
        const prefs = usePreferencesStore.getState();
        prefs.setQuotationLastRemoteUrl(nextUrl);
        if (prefs.quotationEngine.type === 'remote') {
          prefs.setQuotationEngine({ type: 'remote', url: nextUrl });
        }
        set({
          config: usePreferencesStore.getState().quotationEngine,
          lastRemoteUrl: nextUrl,
        });
      },
      reset: () => {
        const prefs = usePreferencesStore.getState();
        prefs.setQuotationEngine({ type: 'local' });
        prefs.setQuotationLastRemoteUrl('');
        set({ config: { type: 'local' }, lastRemoteUrl: '' });
      },
    };
  }
);
