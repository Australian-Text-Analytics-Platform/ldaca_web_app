import React from 'react';
import { cn } from '@/lib/utils';

/** Default copy shared by analysis panels that are locked to an existing task. */
export const ANALYSIS_LOCKED_MESSAGE = 'Analysis locked to the last request. Clear results to unlock and resync data block choices.';

type AnalysisLockedNoticeProps = {
  message?: string;
  className?: string;
};

/**
 * Renders the compact lock notice used by analysis parameter panels while the
 * current results still own their submitted node/column selections.
 * Used by: analysis parameter panels via ANALYSIS_LOCKED_MESSAGE/default export because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 */
const AnalysisLockedNotice: React.FC<AnalysisLockedNoticeProps> = ({ message = ANALYSIS_LOCKED_MESSAGE, className }) => (
  <div className={cn('rounded-md border border-dashed border-muted-foreground/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground', className)}>
    {message}
  </div>
);

export default AnalysisLockedNotice;
