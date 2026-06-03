import React from 'react';

import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface AnalysisTableScrollAreaProps {
  maxHeightClass: string;
  children: React.ReactNode;
  contentClassName?: string;
  className?: string;
}

/**
 * Wraps wide analysis result tables in the project's standard two-axis scroll
 * area so feature tables do not each implement overflow chrome.
 * Used by: concordance and quotation result table blocks because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 */
export const AnalysisTableScrollArea = ({
  maxHeightClass,
  children,
  contentClassName = 'min-w-max',
  className,
}: AnalysisTableScrollAreaProps) => (
  <ScrollArea
    type="hover"
    scrollbars="both"
    data-testid="analysis-table-scroll-area"
    className={cn(maxHeightClass, className)}
  >
    <div className={contentClassName}>{children}</div>
  </ScrollArea>
);
