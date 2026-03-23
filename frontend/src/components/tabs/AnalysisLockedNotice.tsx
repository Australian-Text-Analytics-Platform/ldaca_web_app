import React from 'react';
import { cn } from '../../lib/utils';

export const ANALYSIS_LOCKED_MESSAGE = 'Analysis locked to the last request. Clear results to unlock and resync data block choices.';

type AnalysisLockedNoticeProps = {
  message?: string;
  className?: string;
};

const AnalysisLockedNotice: React.FC<AnalysisLockedNoticeProps> = ({ message = ANALYSIS_LOCKED_MESSAGE, className }) => (
  <div className={cn('rounded-md border border-dashed border-muted-foreground/50 bg-muted/40 px-3 py-2 text-xs text-muted-foreground', className)}>
    {message}
  </div>
);

export default AnalysisLockedNotice;
