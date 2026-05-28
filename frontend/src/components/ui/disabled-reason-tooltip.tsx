import * as React from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

export interface DisabledReasonTooltipProps {
  /**
   * When non-empty, a styled tooltip is shown on hover explaining why the
   * wrapped control is currently disabled. When falsy (undefined, null, or
   * empty string) the children render unchanged with no wrapping.
   */
  reason?: string | null;
  /** Tooltip side. Defaults to `top`. */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Class applied to the wrapping `<span>` that catches pointer events on
   * behalf of the (possibly disabled) child. Defaults to `inline-flex` so
   * the wrapper tracks the child's natural layout.
   */
  className?: string;
  /**
   * Hover-display delay in ms. Defaults to 0 — the tooltip appears
   * immediately so the user sees the reason as soon as the disabled cursor
   * lands on the control, rather than waiting the browser's ~1–2 second
   * native `title` delay.
   */
  delayDuration?: number;
  children: React.ReactNode;
}

/**
 * Tooltip wrapper used by feature forms to explain disabled controls. It wraps
 * children only when a reason exists because disabled HTML controls do not emit
 * pointer events for normal tooltip triggers.
 * Flow: return children unchanged without a reason, otherwise wrap them in a span trigger and render TooltipProvider/TooltipContent with side and delay options.
 */
export const DisabledReasonTooltip: React.FC<DisabledReasonTooltipProps> = ({
  reason,
  side = 'top',
  className,
  delayDuration = 0,
  children,
}) => {
  if (!reason) return <>{children}</>;
  const wrapperClass = ['inline-flex', className].filter(Boolean).join(' ');
  return (
    <TooltipProvider delayDuration={delayDuration} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={wrapperClass}>{children}</span>
        </TooltipTrigger>
        <TooltipContent side={side}>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
