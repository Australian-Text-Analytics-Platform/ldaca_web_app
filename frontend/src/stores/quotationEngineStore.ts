import { create } from 'zustand';
import type { QuotationEngineConfig } from '@/api/text';
import { usePreferencesStore } from './preferencesStore';

/** Controls the engine-config dialog visibility (Sidebar ↔ QuotationFeature). */
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
 * Quotation engine configuration facade.
 *
 * All persistence lives in `usePreferencesStore`; this store exists so that
 * `QuotationFeature` can subscribe with a stable selector API. The `config`
 * and `lastRemoteUrl` fields are kept in sync via `set` on each mutator so
 * subscribers re-render as expected (zustand selectors need actual state
 * writes — they don't observe the foreign store behind the getters).
 */
const migrateLegacyConfig = () => {
  if (typeof window === 'undefined') return;
  const oldRaw = window.localStorage.getItem('ldaca.quotation.engine');
  if (!oldRaw) return;
  // Narrow try/catch: legacy blob may be malformed JSON.
  try {
    const parsed = JSON.parse(oldRaw);
    const oldConfig = parsed?.state?.config as QuotationEngineConfig | undefined;
    const oldUrl = (parsed?.state?.lastRemoteUrl as string) ?? '';
    if (oldConfig) {
      const prefs = usePreferencesStore.getState();
      prefs.setQuotationEngine(oldConfig);
      if (oldUrl) prefs.setQuotationLastRemoteUrl(oldUrl);
    }
  } catch {
    /* legacy payload unreadable — discard */
  }
  window.localStorage.removeItem('ldaca.quotation.engine');
};

export const useQuotationEngineConfigStore = create<QuotationEngineConfigState>((set) => {
  migrateLegacyConfig();
  const prefs = usePreferencesStore.getState();

  const syncFromPrefs = () => {
    const p = usePreferencesStore.getState();
    set({ config: p.quotationEngine, lastRemoteUrl: p.quotationLastRemoteUrl });
  };

  return {
    config: prefs.quotationEngine,
    lastRemoteUrl: prefs.quotationLastRemoteUrl,

    setConfig: (config) => {
      const p = usePreferencesStore.getState();
      if (config.type === 'local') {
        p.setQuotationEngine({ type: 'local' });
      } else {
        const nextUrl = (config.url ?? p.quotationLastRemoteUrl ?? '').trim();
        p.setQuotationEngine({ type: 'remote', url: nextUrl });
        p.setQuotationLastRemoteUrl(nextUrl);
      }
      syncFromPrefs();
    },

    updateRemoteUrl: (url) => {
      const nextUrl = url.trim();
      const p = usePreferencesStore.getState();
      p.setQuotationLastRemoteUrl(nextUrl);
      if (p.quotationEngine.type === 'remote') {
        p.setQuotationEngine({ type: 'remote', url: nextUrl });
      }
      syncFromPrefs();
    },

    reset: () => {
      const p = usePreferencesStore.getState();
      p.setQuotationEngine({ type: 'local' });
      p.setQuotationLastRemoteUrl('');
      syncFromPrefs();
    },
  };
});
