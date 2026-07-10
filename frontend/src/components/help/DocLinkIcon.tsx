import { CircleHelp, Info, Quote, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores';
import {
  getDocumentTarget,
  type DocLinkKind,
  type DocumentKey,
} from '@/tutorials/documentationRegistry';

interface DocLinkConfig {
  Icon: LucideIcon;
  defaultLabel: string;
  defaultClassName: string;
  missingMessage: string;
}

/** Documentation modal configuration consumed by `DocLinkIcon` for each icon kind. */
const CONFIG: Record<DocLinkKind, DocLinkConfig> = {
  tutorial: {
    Icon: CircleHelp,
    defaultLabel: 'Learn more',
    defaultClassName: 'h-6 w-6 text-muted-foreground',
    missingMessage: 'No anchor found for this help item.',
  },
  info: {
    Icon: Info,
    defaultLabel: 'More info',
    defaultClassName: 'h-6 w-6 text-blue-500',
    missingMessage: 'No anchor found for this information item.',
  },
  reference: {
    Icon: Quote,
    defaultLabel: 'View reference',
    defaultClassName: 'h-6 w-6',
    missingMessage: 'No anchor found for this reference item.',
  },
};

export interface DocLinkIconProps<Kind extends DocLinkKind> {
  kind: Kind;
  targetKey: DocumentKey<Kind>;
  label?: string;
  tooltip?: string;
  className?: string;
}

/**
 * Unified documentation icon used by the Help/Info/Reference wrappers. It
 * resolves registry keys, opens the matching modal through `useUIStore`, and
 * gives callers a shared tooltip/button treatment for documentation links.
 * Why: help, info, and reference affordances share registry lookup, missing-target feedback, and modal dispatch.
 * Flow: choose the icon config, resolve label and tooltip text, open the registry target or toast when missing, then render the icon button.
 */
export function DocLinkIcon<Kind extends DocLinkKind>({
  kind,
  targetKey,
  label,
  tooltip,
  className,
}: DocLinkIconProps<Kind>) {
  const config = CONFIG[kind];
  const resolvedLabel = label ?? config.defaultLabel;
  const tooltipText = tooltip ?? resolvedLabel;
  const Icon = config.Icon;

  /** Called by: the DocLinkIcon button onClick prop. */
  const handleClick = () => {
    const target = getDocumentTarget(kind, targetKey);
    if (!target) {
      toast(config.missingMessage);
      return;
    }
    useUIStore.getState().openDocument(target);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className ?? config.defaultClassName}
          aria-label={resolvedLabel}
          onClick={handleClick}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipText}</TooltipContent>
    </Tooltip>
  );
}
