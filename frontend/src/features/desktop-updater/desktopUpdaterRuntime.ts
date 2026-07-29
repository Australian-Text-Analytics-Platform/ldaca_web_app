import type { Update } from '@tauri-apps/plugin-updater';

/** The live updater resource returned by Tauri after a signed manifest check. */
export type DesktopUpdate = Update;

const DESKTOP_UPDATE_CHECK_EVENT = 'desktop-update-check-requested';
const UPDATE_CHECK_TIMEOUT_MS = 15_000;

/** Connects the native application-menu action to the React update prompt. */
export async function listenForDesktopUpdateCheck(listener: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen(DESKTOP_UPDATE_CHECK_EVENT, listener);
}

/** Shows and focuses the dedicated native updater window. */
export async function showDesktopUpdaterWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const updaterWindow = getCurrentWindow();
  await updaterWindow.show();
  await updaterWindow.setFocus();
}

/** Hides the dedicated native updater window without destroying its updater resource. */
export async function hideDesktopUpdaterWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

/** Checks the configured signed update endpoint for a newer desktop release. */
export async function checkDesktopUpdate(): Promise<DesktopUpdate | null> {
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error('The update check timed out.'));
    }, UPDATE_CHECK_TIMEOUT_MS);
  });
  const checkPromise = import('@tauri-apps/plugin-updater')
    .then(({ check }) => check({ timeout: UPDATE_CHECK_TIMEOUT_MS }))
    .then(async (update) => {
      if (!timedOut) return update;
      if (update) await update.close();
      throw new Error('The update check timed out.');
    });

  try {
    return await Promise.race([checkPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Restarts the desktop process after the updater has installed a release. */
export async function relaunchDesktopApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
