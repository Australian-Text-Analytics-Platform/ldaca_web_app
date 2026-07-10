/**
 * Detects the Tauri desktop runtime so file/download helpers can choose native
 * plugin APIs while the web build keeps using browser primitives.
 */
/** Used by: DataFolderSettingsPanel, feedbackContext, ExportFeature, and other runtime-aware consumers to isolate browser-only behavior from Tauri integrations. */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}
