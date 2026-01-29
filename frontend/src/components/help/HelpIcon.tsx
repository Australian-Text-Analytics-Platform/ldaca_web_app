import React from 'react';
import { CircleHelp } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores';
import { getTutorialTarget } from '@/tutorials/tutorialRegistry';

export interface HelpIconProps {
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

const HelpIcon: React.FC<HelpIconProps> = ({ targetKey, label = 'Learn more', tooltip, className }) => {
  const openTutorialTarget = useUIStore((state) => state.openTutorialTarget);
  const tooltipText = tooltip ?? label;
  const ariaLabel = label ?? tooltipText;

  const handleClick = () => {
    const target = getTutorialTarget(targetKey);
    if (!target) {
      toast('No anchor found for this help item.');
      return;
    }
    openTutorialTarget(target);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className ?? 'h-6 w-6 text-muted-foreground'}
          aria-label={ariaLabel}
          onClick={handleClick}
        >
          <CircleHelp className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
};

export default HelpIcon;
