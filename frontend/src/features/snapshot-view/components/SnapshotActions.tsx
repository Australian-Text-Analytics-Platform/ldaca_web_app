import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { snapshotsApi } from '@/api/snapshots';
import { useAuth } from '@/hooks/useAuth';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { LoadSnapshotDialog } from './LoadSnapshotDialog';
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
  /** Called when the user clicks Open on a snapshot row. The host
   * decodes the bundle and engages snapshot view. If absent, the
   * Open buttons in the load dialog show "view coming soon" — Phase
   * 1b-2 wires the host side. */
  onOpenSnapshot?: (filename: string) => Promise<void>;
}

/**
 * Right-side action slot in <AnalysisFeatureHeader>. Renders Save +
 * Load buttons for the demo-snapshot feature. The render is gated on
 * the demo-snapshot master switch — when off, returns null so no DOM
 * is added.
 *
 * Plan §3.7 + §5.7. Load is further gated on the snapshot list for
 * this tool being non-empty — "no snapshots saved yet" is conveyed
 * by absence, not by an empty dialog.
 */
export const SnapshotActions: React.FC<SnapshotActionsProps> = ({
  tool,
  onSave,
  disabledReason,
  onOpenSnapshot,
}) => {
  const enabled = usePreferencesStore((s) => s.demoSnapshotsEnabled);
  const { getAuthHeaders } = useAuth();
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);

  // Fetch the existing snapshot list for this tool. Always-on when
  // demo mode is enabled so:
  //   - the Save dialog can inline-validate name collisions
  //   - the Load button mounts only when ≥1 snapshot exists
  const { data: listData } = useQuery({
    queryKey: ['snapshots-list', tool],
    queryFn: () => snapshotsApi.list(tool, getAuthHeaders()),
    enabled,
    staleTime: 10_000,
  });

  if (!enabled) return null;

  const existingFilenames = listData?.items.map((it) => it.filename) ?? [];
  const hasSnapshots = existingFilenames.length > 0;
  const defaultName = `demo-${new Date().toISOString().slice(0, 10)}`;
  const isSaveDisabled = Boolean(disabledReason);

  return (
    <>
      {hasSnapshots && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLoadOpen(true)}
          aria-label="Load saved snapshot"
        >
          <FolderOpen className="mr-1.5 h-4 w-4" />
          Load
        </Button>
      )}

      {onSave && (
        <DisabledReasonTooltip reason={disabledReason ?? undefined}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isSaveDisabled}
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

      <LoadSnapshotDialog
        open={loadOpen}
        onOpenChange={setLoadOpen}
        tool={tool}
        onOpenSnapshot={onOpenSnapshot}
      />
    </>
  );
};
