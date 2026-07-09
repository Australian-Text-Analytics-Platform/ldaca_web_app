/**
 * UI store barrel.
 *
 * Used by: layout/routing code that needs the active-view store and `ViewType`
 * without importing the UI store module directly. Other stores are imported
 * from their owning modules until they are intentionally promoted here.
 */

export { useUIStore } from './uiStore';
export type { ViewType } from './uiStore';
