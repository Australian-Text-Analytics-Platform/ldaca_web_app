import React from 'react';
import { Cog } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const SettingsDialog = React.lazy(() =>
  import('@/components/dialogs/SettingsDialog').then(({ SettingsDialog }) => ({
    default: SettingsDialog,
  })),
);

interface SettingsButtonProps {
  className?: string;
  iconClassName?: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>['side'];
}

/** Opens the shared Settings dialog from application chrome. */
export function SettingsButton({
  className,
  iconClassName,
  tooltipSide = 'right',
}: SettingsButtonProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-tauri-drag-region="false"
            className={cn('h-7 w-7 text-description', className)}
            aria-label="Open settings"
            onClick={() => {
              setOpen(true);
            }}
          >
            <Cog data-testid="settings-button-icon" className={iconClassName ?? 'h-4 w-4'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>Settings</TooltipContent>
      </Tooltip>

      {open ? (
        <React.Suspense fallback={null}>
          <SettingsDialog open onOpenChange={setOpen} />
        </React.Suspense>
      ) : null}
    </>
  );
}
