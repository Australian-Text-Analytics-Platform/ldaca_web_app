import React from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import type { TutorialTargetKey } from '@/tutorials/tutorialRegistry';

export interface AnalysisFeatureHeaderProps {
  /** Title shown in the header — string or arbitrary node. */
  title: React.ReactNode;
  /** Tutorial-registry key for the info icon. */
  infoKey: TutorialTargetKey | (string & {});
  /** Accessible label / tooltip body for the info icon. */
  infoLabel: string;
  infoTooltip?: string;
  /** Tutorial-registry key for the help icon. */
  helpKey: TutorialTargetKey | (string & {});
  helpLabel: string;
  helpTooltip?: string;
}

/**
 * Shared header for every analytic tool's primary card. Owns the
 * title + info/help icons in a shared ``<CardHeader>`` block.
 * Used by: concordance parameter panel.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function AnalysisFeatureHeader({
  title,
  infoKey,
  infoLabel,
  infoTooltip,
  helpKey,
  helpLabel,
  helpTooltip,
}: AnalysisFeatureHeaderProps) {
  return (
    <CardHeader className="space-y-0 pb-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <CardTitle className="flex items-center gap-2">
          {title}
          <InfoIcon targetKey={infoKey} label={infoLabel} tooltip={infoTooltip} />
          <HelpIcon targetKey={helpKey} label={helpLabel} tooltip={helpTooltip} />
        </CardTitle>
      </div>
    </CardHeader>
  );
}
