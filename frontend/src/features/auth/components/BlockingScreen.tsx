import React from 'react';
import logo from '../../../logo.png';

interface BlockingScreenProps {
  title: string;
  description: string;
  status?: string;
  hint?: string;
  error?: string | null;
  actions?: React.ReactNode;
  showLogo?: boolean;
}

/**
 * Shared full-screen gate used by startup/auth flows when the app cannot yet
 * show the workspace. `App` and login helpers supply copy/actions while this
 * component keeps the loading shell visually consistent.
 * Why: startup and auth gates share the same shell while callers own the precise copy and recovery actions.
 * Flow: render optional logo and copy, show spinner/status/hint, then add error details and caller-supplied actions when present.
 */
function BlockingScreen({
  title,
  description,
  status = 'Loading…',
  hint,
  error,
  actions,
  showLogo = true,
}: BlockingScreenProps) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-editor px-4 py-10">
      <div className="w-full max-w-xl space-y-4 rounded-lg border bg-surface px-10 py-12 text-center">
        {showLogo && (
          <div className="flex justify-center">
            <img src={logo} alt="LDaCA Logo" className="h-16 w-auto object-contain" />
          </div>
        )}
        <div className="space-y-2">
          <h1 className="text-heading-1 font-semibold">{title}</h1>
          <p className="text-body text-description">{description}</p>
        </div>
        <div className="flex flex-col items-center space-y-3">
          <div className="size-8 animate-spin rounded-full border-2 border-surface-border border-t-primary" />
          <p className="font-semibold">{status}</p>
          {hint && <p className="mx-auto max-w-sm text-body-secondary text-description">{hint}</p>}
        </div>
        {error && (
          <div className="rounded-md border border-error bg-error-background px-3 py-2 text-left">
            <p className="mb-1 text-body font-semibold text-error">Still waiting…</p>
            <p className="text-body text-error">{error}</p>
          </div>
        )}
        {actions && <div className="flex flex-wrap justify-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}

export default BlockingScreen;
