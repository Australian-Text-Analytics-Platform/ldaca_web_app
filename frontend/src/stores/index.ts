/**
 * Zustand store barrel.
 *
 * Import stores from `@/stores` rather than individual files so consumers
 * don't leak implementation details (slice names, file layout). Types are
 * re-exported alongside their stores.
 */

export { useUIStore } from './uiStore';
export type { ViewType } from './uiStore';
