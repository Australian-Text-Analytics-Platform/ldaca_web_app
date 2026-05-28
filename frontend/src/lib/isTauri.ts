/**
 * Detects the Tauri desktop runtime so file/download helpers can choose native
 * plugin APIs while the web build keeps using browser primitives.
 */
/** Used by: src/components/dialogs/DataFolderDialog.tsx, src/components/panels/feedbackContext.ts, src/features/views/export/ExportFeature.tsx and 2 other importers because the library needs this local step to isolate browser, data, or runtime edge cases for importers. */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}
