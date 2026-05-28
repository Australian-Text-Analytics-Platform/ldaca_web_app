import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { REFRESH_CHIP_DELAY_MS } from '@/config/timings';
import { formatAttemptLabel, formatTimestamp } from './authPhaseCopy';

/**
 * Top-of-screen auth recovery status used by the app shell while background
 * session refreshes fail or run long. It reads `useAuth` directly so every
 * route gets the same retry affordance without prop-drilling auth state.
 * Why: degraded auth refreshes need one global retry surface without threading auth phase through every view.
 * Flow: delay the refreshing chip, derive degraded banner copy from auth phase, then render retry banner/chip or nothing.
 */
export function RefreshStatusBanner() {
  const { phase, refreshAuth } = useAuth();
  const [refreshChipReady, setRefreshChipReady] = useState(false);

  useEffect(() => {
    if (phase.status !== 'refreshing') return;
    const timeoutId = window.setTimeout(() => setRefreshChipReady(true), REFRESH_CHIP_DELAY_MS);
    return () => {
      window.clearTimeout(timeoutId);
      setRefreshChipReady(false);
    };
  }, [phase.status]);

  const degradedPhase = phase.status === 'degraded' ? phase : null;
  const showRefreshBanner = Boolean(degradedPhase);
  const showRefreshChip = phase.status === 'refreshing' && refreshChipReady;

  if (!showRefreshBanner && !showRefreshChip) return null;

  const bannerAttemptsLabel = degradedPhase ? formatAttemptLabel(degradedPhase.attempts) : null;
  const bannerMessage = degradedPhase?.error ?? 'Having trouble refreshing your session.';
  const bannerTime = degradedPhase ? formatTimestamp(degradedPhase.lastFailureAt) : null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col gap-2">
      {showRefreshBanner && bannerAttemptsLabel && (
        <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-lg">
          <span className="font-medium text-amber-900">Connection hiccup</span>
          <span className="text-xs text-amber-900/80">{bannerMessage}</span>
          <span className="text-xs text-amber-900/70">Attempts {bannerAttemptsLabel}</span>
          {bannerTime && (
            <span className="text-xs text-amber-900/60">Last failure {bannerTime}</span>
          )}
          <button
            type="button"
            onClick={refreshAuth}
            className="rounded-full border border-amber-400 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Retry now
          </button>
        </div>
      )}
      {showRefreshChip && (
        <div className="flex items-center gap-2 self-center rounded-full bg-slate-900/90 px-3 py-1 text-xs font-medium text-white shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" aria-hidden />
          Reconnecting…
        </div>
      )}
    </div>
  );
}
