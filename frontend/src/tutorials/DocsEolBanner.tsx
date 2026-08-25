import { useState } from 'react';

import { useRegistryStore } from './registryStore';

const DISMISS_STORAGE_KEY = 'ldaca.docs.eol.dismissedFor';

/**
 * Top-of-screen warning shown when the merged registry's
 * `meta.eolDate` has passed — i.e. the docs branch this app build is
 * pinned to has been retired. Older app binaries can stay functional,
 * but the user should be nudged to upgrade.
 *
 * Dismissable per docs version: dismissing for `v0.3` doesn't suppress
 * the banner once a future build talks to a different docs version.
 */
/**
 * Rendered by `GlobalHosts` so registry end-of-life notices remain visible
 * across startup and auth states. Flow: read merged registry metadata, compare
 * its EOL date with the mount-time clock, suppress a version already dismissed,
 * then render the upgrade notice.
 */
export function DocsEolBanner() {
  const meta = useRegistryStore((s) => s.meta);
  const [dismissedFor, setDismissedFor] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(DISMISS_STORAGE_KEY);
  });

  const eolDate = meta?.eolDate;
  const version = meta?.version ?? null;

  // Snapshot the wall clock once at mount so subsequent renders are pure.
  // The user keeping the app open across an EOL boundary won't see the
  // banner appear until they reload — acceptable for a "docs version
  // retired" nudge that's already informational rather than time-critical.
  const [evaluatedAt] = useState(() => Date.now());
  const parsedEolDate = eolDate ? Date.parse(eolDate) : Number.NaN;
  const isPastEol = !Number.isNaN(parsedEolDate) && parsedEolDate <= evaluatedAt;

  if (!isPastEol || !eolDate) return null;
  if (version && dismissedFor === version) return null;

  /** Persists dismissal by docs version so future retired versions can warn again. */
  /** Called by the banner's Dismiss button. */
  const dismiss = () => {
    const key = version ?? eolDate;
    setDismissedFor(key);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, key);
    } catch {
      // non-fatal
    }
  };

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col gap-2">
      <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-warning bg-warning-background px-4 py-2 text-body text-warning">
        <span className="font-medium">Docs version retired</span>
        <span className="text-label-secondary text-warning/80">
          {version
            ? `Documentation for v${version} is no longer maintained.`
            : 'This documentation version is no longer maintained.'}{' '}
          Please upgrade to the latest app release.
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full border border-warning px-3 py-1 text-label-secondary font-medium hover:bg-warning-background"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
