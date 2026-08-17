/**
 * Detects the Tauri desktop runtime so file/download helpers can choose native
 * plugin APIs while the web build keeps using browser primitives.
 */
/** Used by: DataFolderSettingsPanel, feedback handling, Export, backend-health discovery, and downloads. */
export function isTauri(location?: Pick<Location, 'hostname' | 'protocol'>): boolean {
  if (typeof window === 'undefined') return false;
  const currentLocation = location ?? window.location;
  return (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    currentLocation.protocol === 'tauri:' ||
    currentLocation.hostname === 'tauri.localhost'
  );
}
