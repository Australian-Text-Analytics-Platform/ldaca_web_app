import type { Update } from '@tauri-apps/plugin-updater';

/** The live updater resource returned by Tauri after a signed manifest check. */
export type DesktopUpdate = Update;

/** Reads the installed desktop bundle version from Tauri. */
export async function getDesktopVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Checks the configured signed update endpoint for a newer desktop release. */
export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  const { check } = await import('@tauri-apps/plugin-updater');
  return check();
}

/** Restarts the desktop process after the updater has installed a release. */
export async function relaunchDesktopApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
