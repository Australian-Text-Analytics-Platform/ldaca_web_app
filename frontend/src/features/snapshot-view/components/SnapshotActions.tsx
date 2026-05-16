import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { snapshotsApi } from '@/api/snapshots';
import { useAuth } from '@/hooks/useAuth';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { SaveSnapshotDialog } from './SaveSnapshotDialog';
import type { SnapshotToolKey } from '../types';

export interface SnapshotActionsProps {
  tool: SnapshotToolKey;
  /** Called when the user clicks Save in the dialog with a validated
   * filename and the description text. The host feature (e.g.
   * ConcordanceFeature) implements this — it knows how to assemble
   * the bundle from its in-memory state. If absent, the Save button
   * doesn't render — the tool hasn't wired itself up yet (a useful
   * Phase 1 staging signal). */
  onSave?: (filename: string, description: string) => Promise<void>;
  /** When set, the Save button is rendered disabled with this string
   * as a hover tooltip. Mirrors the ``runDisabledReason`` pattern
   * elsewhere in the analytic panels — host features compute the
   * reason synchronously (e.g. "Largest selected data block has X
   * rows; demo cap is 2 000.") and pass it in. */
  disabledReason?: string | null;
}

/**
 * Right-side action slot in <AnalysisFeatureHeader>. Renders Save
 * (always, when demo mode is on + onSave is provided) and Load
 * (Phase 1b — only when the snapshot list for this tool is
 * non-empty).
 *
 * Plan §3.7 + §5.7. The render is gated on the demo-snapshot
 * master switch — when off, returns null so no DOM is added.
 */
export const SnapshotActions: React.FC<SnapshotActionsProps> = ({
  tool,
  onSave,
  disabledReason,
}) => {
  const enabled = usePreferencesStore((s) => s.demoSnapshotsEnabled);
  const { getAuthHeaders } = useAuth();
  const [saveOpen, setSaveOpen] = useState(false);

  // Fetch the existing snapshot list for this tool so the Save
  // dialog can inline-validate name collisions. Cached briefly so
  // re-opening the dialog doesn't re-fetch on every keystroke.
  const { data: listData } = useQuery({
    queryKey: ['snapshots-list', tool],
    queryFn: () => snapshotsApi.list(tool, getAuthHeaders()),
    enabled: enabled && saveOpen,
    staleTime: 10_000,
  });

  if (!enabled) return null;

  const existingFilenames = listData?.items.map((it) => it.filename) ?? [];
  const defaultName = `demo-${new Date().toISOString().slice(0, 10)}`;
  const isDisabled = Boolean(disabledReason);

  return (
    <>
      {onSave && (
        <DisabledReasonTooltip reason={disabledReason ?? undefined}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isDisabled}
            onClick={() => setSaveOpen(true)}
            aria-label="Save snapshot"
          >
            <Camera className="mr-1.5 h-4 w-4" />
            Save
          </Button>
        </DisabledReasonTooltip>
      )}

      {onSave && (
        <SaveSnapshotDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          tool={tool}
          existingFilenames={existingFilenames}
          defaultName={defaultName}
          onSave={onSave}
        />
      )}
    </>
  );
};
