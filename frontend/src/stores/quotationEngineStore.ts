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
  /** Supports controlled dialog callbacks from Radix/shadcn open-state changes. */
  /** Consumed by: useQuotationEngineDialogStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
  setOpen: (isOpen) => set({ isOpen }),
  /** Opens the quotation-engine configuration dialog from sidebar actions. */
  /** Consumed by: useQuotationEngineDialogStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
  open: () => set({ isOpen: true }),
  /** Closes the dialog after save/cancel or overlay dismissal. */
  /** Consumed by: useQuotationEngineDialogStore selectors and actions because UI callers need one typed store boundary for reading shared state and committing updates. */
  close: () => set({ isOpen: false }),
}));
