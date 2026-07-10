/**
 * Detects the Tauri desktop runtime so file/download helpers can choose native
 * plugin APIs while the web build keeps using browser primitives.
 */
/** Used by: DataFolderSettingsPanel, feedback handling, Export, backend-health discovery, and downloads. */
export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}
