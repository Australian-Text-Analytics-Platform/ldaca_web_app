/**
 * Zustand store barrel.
 *
 * Import stores from `@/stores` rather than individual files so consumers
 * don't leak implementation details (slice names, file layout). Types are
 * re-exported alongside their stores.
 */

export { useUIStore } from './uiStore';
export type { ViewType, ModalKind, ModalTarget } from './uiStore';

export { useSelectionStore } from './selectionStore';

export { useQuotationEngineDialogStore } from './quotationEngineStore';

export { usePreferencesStore } from './preferencesStore';

export { useAnalysisStore } from './analysisStore';
export type { TaskItem, PendingConcordance } from './analysisStore';

export { useAuthStore, REFRESH_FAILURE_THRESHOLD } from './authStore';
export type { AuthPhase, FetchReason } from './authStore';
