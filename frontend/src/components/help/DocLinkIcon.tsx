import { CircleHelp, Info, Quote, AlertTriangle, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores';
import { getTutorialTarget } from '@/tutorials/tutorialRegistry';
import { getInfoTarget } from '@/tutorials/infoRegistry';
import { getReferenceTarget } from '@/tutorials/referenceRegistry';

type DocLinkKind = 'tutorial' | 'info' | 'reference' | 'warning';

interface DocTarget {
  file: string;
  anchor: string;
  label?: string;
}

interface DocLinkConfig {
  Icon: LucideIcon;
  defaultLabel: string;
  defaultClassName: string;
  missingMessage: string;
  /** Pulled lazily via getState() so this object can be a module-level constant. */
  getTarget: (key: string) => DocTarget | null;
  openTarget: (target: DocTarget) => void;
}

/** Documentation modal configuration consumed by `DocLinkIcon` for each icon kind. */
const CONFIG: Record<DocLinkKind, DocLinkConfig> = {
  tutorial: {
    Icon: CircleHelp,
    defaultLabel: 'Learn more',
    defaultClassName: 'h-6 w-6 text-muted-foreground',
    missingMessage: 'No anchor found for this help item.',
    getTarget: getTutorialTarget,
    /** Called by: DocLinkIcon handleClick for tutorial-key consumers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
    openTarget: (target) => {
      useUIStore.getState().openModal('tutorial', target);
    },
  },
  info: {
    Icon: Info,
    defaultLabel: 'More info',
    defaultClassName: 'h-6 w-6 text-blue-500',
    missingMessage: 'No anchor found for this information item.',
    getTarget: getInfoTarget,
    /** Called by: DocLinkIcon handleClick for information-key consumers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
    openTarget: (target) => {
      useUIStore.getState().openModal('info', target);
    },
  },
  reference: {
    Icon: Quote,
    defaultLabel: 'View reference',
    defaultClassName: 'h-6 w-6',
    missingMessage: 'No anchor found for this reference item.',
    getTarget: getReferenceTarget,
    /** Called by: DocLinkIcon handleClick for reference-key consumers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
    openTarget: (target) => {
      useUIStore.getState().openModal('reference', target);
    },
  },
  warning: {
    Icon: AlertTriangle,
    defaultLabel: 'View warning',
    defaultClassName: 'h-6 w-6 text-amber-500',
    missingMessage: 'No anchor found for this warning item.',
    // No registry exists for warnings yet. The store action exists; if a
    // warningRegistry is added later, swap this for getWarningTarget.
    /** Called by: DocLinkIcon handleClick for future warning-key consumers because the caller needs one documented boundary for the lookup, event, or state handoff step. */
    getTarget: () => null,
    /** Called by: DocLinkIcon handleClick for future warning documentation targets because the caller needs one documented boundary for the lookup, event, or state handoff step. */
    openTarget: (target) => {
      useUIStore.getState().openModal('warning', target);
    },
  },
};

export interface DocLinkIconProps {
  kind: DocLinkKind;
  targetKey: string;
  label?: string;
  tooltip?: string;
  className?: string;
}

/**
 * Unified documentation icon used by the Help/Info/Reference wrappers. It
 * resolves registry keys, opens the matching modal through `useUIStore`, and
 * gives callers a shared tooltip/button treatment for documentation links.
 * Why: help, info, warning, and reference affordances share registry lookup, missing-target feedback, and modal dispatch.
 * Flow: choose the icon config, resolve label and tooltip text, open the registry target or toast when missing, then render the icon button.
 */
export function DocLinkIcon({ kind, targetKey, label, tooltip, className }: DocLinkIconProps) {
  const config = CONFIG[kind];
  const resolvedLabel = label ?? config.defaultLabel;
  const tooltipText = tooltip ?? resolvedLabel;
  const Icon = config.Icon;

  /** Called by: the DocLinkIcon button onClick prop because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const handleClick = () => {
    const target = config.getTarget(targetKey);
    if (!target) {
      toast(config.missingMessage);
      return;
    }
    config.openTarget(target);
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
