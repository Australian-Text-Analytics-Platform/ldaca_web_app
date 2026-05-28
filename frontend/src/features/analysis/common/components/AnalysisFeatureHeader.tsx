import React from 'react';
import { CardHeader, CardTitle } from '@/components/ui/card';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import type { TutorialTargetKey } from '@/tutorials/tutorialRegistry';
import { SnapshotActions } from '@/features/snapshot-view/components/SnapshotActions';
import type { SnapshotToolKey } from '@/features/snapshot-view';

export interface AnalysisFeatureHeaderProps {
  /** Drives which tool's snapshot save/load slot mounts on the right.
   * Used by ``<SnapshotActions>`` to scope its store / API calls. */
  tool: SnapshotToolKey;
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
  /** Snapshot save handler. The host feature wires its own capture
  * logic in via this prop — see ``SnapshotActions.onSave``. Optional
  * because tools wire snapshot capture individually. */
  onSaveSnapshot?: (filename: string, description: string) => Promise<void>;
  /** When set, the Save button renders disabled with this string as
   * a hover tooltip — same UX as the Run-disabled pattern elsewhere
   * in the analytic feature panels. Falsy = enabled. */
  saveSnapshotDisabledReason?: string | null;
  /** Snapshot load handler. The host feature decodes the bundle and
   * engages snapshot view. Optional; when absent, Open buttons in the
   * load dialog show "view coming soon". */
  onOpenSnapshot?: (filename: string) => Promise<void>;
  /** Display labels of the currently-selected data blocks. Forwarded
   * to <SnapshotActions> so the Save dialog pre-populates the
   * filename input with something more useful than ``demo-{date}``. */
  snapshotNodeLabels?: string[];
}

/**
 * Shared header for every analytic tool's primary card. Owns the
 * title + info/help icons on the left and the snapshot Save/Load
 * action slot on the right. Replaces each tool's hand-rolled
 * ``<CardHeader>`` block so the snapshot wiring lives once.
 *
 * The right slot returns ``null`` when the demo-snapshot master switch is off,
 * so no DOM is added in the default experience.
 */
export const AnalysisFeatureHeader: React.FC<AnalysisFeatureHeaderProps> = ({
  tool,
  title,
  infoKey,
  infoLabel,
  infoTooltip,
  helpKey,
  helpLabel,
  helpTooltip,
  onSaveSnapshot,
  saveSnapshotDisabledReason,
  onOpenSnapshot,
  snapshotNodeLabels,
}) => {
  return (
    <CardHeader className="space-y-0 pb-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <CardTitle className="flex items-center gap-2">
          {title}
          <InfoIcon targetKey={infoKey} label={infoLabel} tooltip={infoTooltip} />
          <HelpIcon targetKey={helpKey} label={helpLabel} tooltip={helpTooltip} />
        </CardTitle>
        <div
          className="flex items-center gap-2"
          data-testid="analysis-feature-header-actions"
        >
          <SnapshotActions
            tool={tool}
            onSave={onSaveSnapshot}
            disabledReason={saveSnapshotDisabledReason}
            onOpenSnapshot={onOpenSnapshot}
            nodeLabels={snapshotNodeLabels}
          />
        </div>
      </div>
    </CardHeader>
  );
};
