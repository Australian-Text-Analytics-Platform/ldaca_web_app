import React from 'react';
import { BookMarked } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores';
import { getReferenceTarget } from '@/tutorials/referenceRegistry';

export interface ReferenceIconProps {
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

const ReferenceIcon: React.FC<ReferenceIconProps> = ({ targetKey, label = 'View reference', tooltip, className }) => {
  const openReferenceTarget = useUIStore((state) => state.openReferenceTarget);
  const tooltipText = tooltip ?? label;
  const ariaLabel = label ?? tooltipText;

  const handleClick = () => {
    const target = getReferenceTarget(targetKey);
    if (!target) {
      toast('No anchor found for this reference item.');
      return;
    }
    openReferenceTarget(target);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className ?? 'h-6 w-6 text-emerald-600'}
          aria-label={ariaLabel}
          onClick={handleClick}
        >
          <BookMarked className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
};

export default ReferenceIcon;
