import React from 'react';

import { cn } from '../lib/utils';
import { ScrollArea } from './ui/scroll-area';

interface AnalysisTableScrollAreaProps {
  maxHeightClass: string;
  children: React.ReactNode;
  contentClassName?: string;
  className?: string;
}

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

export default AnalysisTableScrollArea;
