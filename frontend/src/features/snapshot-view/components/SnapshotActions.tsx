import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';
import { listSnapshots } from '@/api/generated/sdk.gen';
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
  /** Display labels of the currently-selected data blocks. Used to
   * pre-populate the Save dialog's filename input with something
   * meaningful (e.g. ``Honi-Soit-2026-05-16`` instead of a generic
   * ``demo-2026-05-16``). When empty or omitted, falls back to
   * ``demo-{date}``. The tool prefix is added by the dialog, so
   * callers only need to supply the data-block-derived portion. */
  nodeLabels?: string[];
  /** Optional override for the Save dialog. When provided, the
   * built-in ``<SaveSnapshotDialog>`` is replaced by whatever the
   * caller returns. Trends uses this to inject a richer
   * configuration dialog (finest time bin + group-by columns + row
   * estimator) since its snapshots are data-rich captures rather
   * than direct freezes of the current view. Other tools leave the
   * prop unset and get the standard dialog.
   *
   * The renderer receives the same wiring (open, existingFilenames,
   * defaultName, wrapped onSave that refetches the snapshot list).
   * Cross-tool extras (e.g. capture-time config) flow through the
   * caller's own closure, not this prop. */
  saveDialog?: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    tool: SnapshotToolKey;
    existingFilenames: string[];
    defaultName: string;
    onSave: (filename: string, description: string) => Promise<void>;
  }) => React.ReactNode;
}

/** Slugify a single data-block label for inclusion in the default
 * filename: trim, drop filename-invalid characters, collapse
 * whitespace runs to hyphens. The Save dialog re-runs its own
 * sanitisation when it computes the on-disk filename, so this is
 * just for the readable pre-populated string. */
function slugifyLabel(label: string): string {
  return label
    .trim()
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '-');
}

function buildDefaultName(nodeLabels: string[] | undefined): string {
  const date = new Date().toISOString().slice(0, 10);
  const cleaned = (nodeLabels ?? [])
    .map(slugifyLabel)
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return `demo-${date}`;
  return `${cleaned.join('_')}-${date}`;
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
  nodeLabels,
  saveDialog,
}) => {
  const enabled = usePreferencesStore((s) => s.demoSnapshotsEnabled);
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);

  // Fetch the existing snapshot list for this tool. Always-on when
  // demo mode is enabled so:
  //   - the Save dialog can inline-validate name collisions
  //   - the Load button mounts only when ≥1 snapshot exists
  const { data: listData } = useQuery({
    queryKey: ['snapshots-list', tool],
    queryFn: async () => {
      const { data } = await listSnapshots({
        headers: getAuthHeaders(),
        query: { tool },
        throwOnError: true,
      });
      return data;
    },
    enabled,
    staleTime: 10_000,
  });

  // Wrap the host's onSave so the snapshot list refetches as soon as
  // the upload succeeds. Without this, the Load button stays hidden
  // until the 10-second staleTime expires or the user switches tabs.
  const handleSave = async (filename: string, description: string) => {
    if (!onSave) return;
    await onSave(filename, description);
    await queryClient.invalidateQueries({ queryKey: ['snapshots-list', tool] });
  };

  if (!enabled) return null;

  const existingFilenames = listData?.items.map((it) => it.filename) ?? [];
  const hasSnapshots = existingFilenames.length > 0;
  const defaultName = buildDefaultName(nodeLabels);
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
          {/* Same Camera icon as Save — both buttons act on snapshots,
              the labels Save / Load disambiguate. */}
          <Camera className="mr-1.5 h-4 w-4" />
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
        saveDialog
          ? saveDialog({
              open: saveOpen,
              onOpenChange: setSaveOpen,
              tool,
              existingFilenames,
              defaultName,
              onSave: handleSave,
            })
          : (
            <SaveSnapshotDialog
              open={saveOpen}
              onOpenChange={setSaveOpen}
              tool={tool}
              existingFilenames={existingFilenames}
              defaultName={defaultName}
              onSave={handleSave}
            />
          )
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
