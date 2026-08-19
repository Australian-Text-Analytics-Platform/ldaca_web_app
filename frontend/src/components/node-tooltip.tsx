import { createContext, useContext, useState, type ComponentProps } from 'react';
import { NodeToolbar, type NodeToolbarProps } from '@xyflow/react';

import { cn } from '@/lib/utils';

/* TOOLTIP CONTEXT ---------------------------------------------------------- */

interface TooltipContextType {
  isVisible: boolean;
  showTooltip: () => void;
  hideTooltip: () => void;
}

const TooltipContext = createContext<TooltipContextType | null>(null);

/* TOOLTIP NODE ------------------------------------------------------------- */

export function NodeTooltip({ children, ...props }: ComponentProps<'div'>) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <TooltipContext.Provider
      value={{
        isVisible,
        showTooltip: () => {
          setIsVisible(true);
        },
        hideTooltip: () => {
          setIsVisible(false);
        },
      }}
    >
      <div {...props}>{children}</div>
    </TooltipContext.Provider>
  );
}

/* TOOLTIP TRIGGER ---------------------------------------------------------- */

export function NodeTooltipTrigger({
  onMouseEnter,
  onMouseLeave,
  ...props
}: ComponentProps<'div'>) {
  const tooltipContext = useContext(TooltipContext);
  if (!tooltipContext) {
    throw new Error('NodeTooltipTrigger must be used within NodeTooltip');
  }
  const { showTooltip, hideTooltip } = tooltipContext;

  return (
    <div
      {...props}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        showTooltip();
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        hideTooltip();
      }}
    />
  );
}

/* TOOLTIP CONTENT ---------------------------------------------------------- */

export function NodeTooltipContent({ children, position, className, ...props }: NodeToolbarProps) {
  const tooltipContext = useContext(TooltipContext);
  if (!tooltipContext) {
    throw new Error('NodeTooltipContent must be used within NodeTooltip');
  }
  const { isVisible } = tooltipContext;

  return (
    <NodeToolbar
      isVisible={isVisible}
      className={cn('rounded-sm bg-primary p-2 text-primary-foreground', className)}
      position={position}
      {...props}
    >
      {children}
    </NodeToolbar>
  );
}
