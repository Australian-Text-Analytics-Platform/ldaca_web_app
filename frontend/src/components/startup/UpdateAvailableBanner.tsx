import React, { useEffect, useState } from 'react';

import { get } from '@/api/http';

/** Landing page: hosts the desktop installer downloads and the Binder launch
 *  button. Shown as text so users can visit it in their own browser (the app
 *  does not open links for them). */
const DOWNLOADS_URL = 'https://sih.tools/wordflow';

const DISMISS_STORAGE_KEY = 'ldaca.update.dismissedFor';

interface VersionInfo {
  current: string | null;
  latest: string | null;
  update_available: boolean;
}

/**
 * Non-blocking, top-of-screen banner shown when a newer Wordflow release is
 * available on PyPI. Works on every platform — desktop, uvx-served, and
 * web/Binder/Nectar — because it reads the backend's `/api/version` endpoint
 * (the backend reports its own version + the latest on PyPI). Purely
 * informational: it tells the user a new version exists and where to get it.
 * On a hosted server the user can't self-update but can request one via the
 * feedback form.
 *
 * Dismissals are remembered per target version (localStorage), so it won't nag
 * every launch but reappears once a still-newer version ships. Stays silent
 * when offline or PyPI is unreachable.
 */
export const UpdateAvailableBanner: React.FC = () => {
  const [latest, setLatest] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(DISMISS_STORAGE_KEY);
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await get<VersionInfo>('/version');
        if (!cancelled && result.update_available && result.latest) {
          setLatest(result.latest);
          setCurrent(result.current);
        }
      } catch {
        // Offline, PyPI unreachable, or endpoint missing: stay silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!latest || dismissedFor === latest) return null;

  const dismiss = () => {
    setDismissedFor(latest);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, latest);
    } catch {
      // non-fatal
    }
  };

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col gap-2">
      <div className="pointer-events-auto flex max-w-xl flex-col gap-1 rounded-2xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm text-blue-900 shadow-lg">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">Update available</span>
          <span className="text-xs text-blue-900/80">
            Wordflow {latest} is available
            {current ? ` (you have ${current})` : ''}.
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="ml-auto rounded-full border border-blue-400 px-3 py-1 text-xs font-medium hover:bg-blue-100"
          >
            Dismiss
          </button>
        </div>
        <span className="text-xs text-blue-900/80">
          Download/launch the latest version from{' '}
          <span className="font-medium break-all">{DOWNLOADS_URL}</span>. On a
          shared server, you can request an update via the feedback form.
        </span>
      </div>
    </div>
  );
};
