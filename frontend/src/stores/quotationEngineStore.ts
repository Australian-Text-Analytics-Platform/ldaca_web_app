import { create } from 'zustand';

/**
 * Dialog-visibility store for the quotation-engine config panel.
 *
 * Cross-component bridge: Sidebar opens the dialog (via the Cog button on
 * the Quotation nav item), QuotationFeature renders the dialog body and
 * subscribes to `isOpen`. Pure UI state — engine config + last-remote-url
 * persistence lives in `preferencesStore`.
 */
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
