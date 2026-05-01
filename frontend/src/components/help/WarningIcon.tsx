import React from 'react';
import { CircleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores';
import { getWarningTarget } from '@/tutorials/warningRegistry';

export interface WarningIconProps {
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

const WarningIcon: React.FC<WarningIconProps> = ({ targetKey, label = 'View warning', tooltip, className }) => {
  const openWarningTarget = useUIStore((state) => state.openWarningTarget);
  const tooltipText = tooltip ?? label;
  const ariaLabel = label ?? tooltipText;

  const handleClick = () => {
    const target = getWarningTarget(targetKey);
    if (!target) {
      toast('No anchor found for this warning item.');
      return;
    }
    openWarningTarget(target);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className ?? 'h-6 w-6 text-amber-500'}
          aria-label={ariaLabel}
          onClick={handleClick}
        >
          <CircleAlert className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
};

export default WarningIcon;
