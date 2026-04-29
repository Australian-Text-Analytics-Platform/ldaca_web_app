import React from 'react';
import { Info } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores';
import { getInfoTarget } from '@/tutorials/infoRegistry';

export interface InfoIconProps {
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

const InfoIcon: React.FC<InfoIconProps> = ({ targetKey, label = 'More info', tooltip, className }) => {
  const openInfoTarget = useUIStore((state) => state.openInfoTarget);
  const tooltipText = tooltip ?? label;
  const ariaLabel = label ?? tooltipText;

  const handleClick = () => {
    const target = getInfoTarget(targetKey);
    if (!target) {
      toast('No anchor found for this information item.');
      return;
    }
    openInfoTarget(target);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className ?? 'h-6 w-6 text-blue-500'}
          aria-label={ariaLabel}
          onClick={handleClick}
        >
          <Info className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
};

export default InfoIcon;
