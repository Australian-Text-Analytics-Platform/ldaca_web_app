import { isTauri } from '@/lib/isTauri';

/** Returns true only for Wordflow's macOS Tauri webview, never a browser deployment. */
export function isMacOSDesktop(
  location?: Pick<Location, 'hostname' | 'protocol'>,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): boolean {
  return isTauri(location) && /Macintosh|Mac OS X/.test(userAgent);
}
