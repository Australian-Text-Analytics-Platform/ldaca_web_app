import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface AnalysisTableScrollAreaProps {
  maxHeightClass: string;
  children: React.ReactNode;
  contentClassName?: string;
  className?: string;
}

/**
 * Wraps wide analysis result tables in the project's standard two-axis scroll
 * area so feature tables do not each implement overflow chrome.
 * Used by: concordance and quotation result table blocks.
 */
const AnalysisTableScrollArea = ({
  maxHeightClass,
  children,
  contentClassName = 'min-w-max',
  className,
}: AnalysisTableScrollAreaProps) => (
  <ScrollArea
    scrollbars="both"
    data-testid="analysis-table-scroll-area"
    className={cn(maxHeightClass, className)}
  >
    <div className={contentClassName}>{children}</div>
  </ScrollArea>
);

interface AnalysisTableFrameProps extends AnalysisTableScrollAreaProps {
  belowTable?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Adds the standard rounded/bordered analysis table shell around
 * AnalysisTableScrollArea.
 * Used by: concordance and quotation result blocks because those views need the
 * same clipped border boundary around scrollable tables without re-creating the
 * wrapper classes in every table component.
 */
export const AnalysisTableFrame = ({
  maxHeightClass,
  children,
  belowTable,
  contentClassName,
  className,
  style,
}: AnalysisTableFrameProps) => (
  <div
    className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}
    style={style}
  >
    <AnalysisTableScrollArea maxHeightClass={maxHeightClass} contentClassName={contentClassName}>
      {children}
    </AnalysisTableScrollArea>
    {belowTable}
  </div>
);
