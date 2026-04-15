/**
 * Centralized store exports for the refactored frontend architecture
 * Provides clean, organized imports for all store functionality
 */

export { useUIStore } from './uiStore';
export type { ViewType } from './uiStore';
export { useSelectionStore } from './selectionStore';
export { useQuotationEngineDialogStore, useQuotationEngineConfigStore } from './quotationEngineStore';
export { usePreferencesStore } from './preferencesStore';
