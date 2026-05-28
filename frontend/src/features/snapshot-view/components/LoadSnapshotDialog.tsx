import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Info, Quote, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { batchDeleteSnapshots, deleteSnapshot, listSnapshots } from '@/api/generated/sdk.gen';
import type { SnapshotListItem } from '@/api/generated/types.gen';
import { formatBytes } from '@/lib/utils';
import { getCurrentAppVersion, isCompatibleSnapshot } from '../compat';
import type { SnapshotToolKey } from '../types';
import { SnapshotDescriptionDialog } from './SnapshotDescriptionDialog';

export interface LoadSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: SnapshotToolKey;
  /** Called when the user clicks Open on a compatible row. The host
   * decodes the bundle and engages snapshot view; this dialog just
   * delivers the filename. If absent, Open is disabled with a
   * "view coming soon" tooltip. */
  onOpenSnapshot?: (filename: string) => Promise<void>;
}

/**
 * Short human label for a captured-at ISO string.
   * Used by: local callers in snapshot-view/LoadSnapshotDialog module.
   * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
   */
function formatCapturedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface DecoratedItem {
  item: SnapshotListItem;
  compatible: boolean;
}

/**
 * Lists saved snapshots for one tool, opens compatible bundles, and manages
 * per-row or batch deletion flows.
 * Rendered by: compat module, index module, SnapshotActions component (rg call sites/imports) because feature headers need a shared loader for compatible saved bundles.
 * Flow: the user chooses a bundle, entries are queried, a mutation parses the selected payload, and feature state hydrates from it.
 */
export function LoadSnapshotDialog({
  open,
  onOpenChange,
  tool,
  onOpenSnapshot,
}: LoadSnapshotDialogProps) {
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const [descriptionFor, setDescriptionFor] = useState<{ filename: string; title: string } | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<DecoratedItem | null>(null);
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false);
  const [openingFilename, setOpeningFilename] = useState<string | null>(null);

  const currentVersion = getCurrentAppVersion();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['snapshots-list', tool],
        /**
     * Loads the tool-specific snapshot index when the dialog is open.
         * Called by: useQuery option object inside LoadSnapshotDialog.
         * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
         */
    queryFn: async () => {
      const { data } = await listSnapshots({
        headers: getAuthHeaders(),
        query: { tool },
        throwOnError: true,
      });
      return data;
    },
    enabled: open,
    staleTime: 10_000,
  });

  const decorated: DecoratedItem[] = (data?.items ?? []).map((item) => ({
    item,
    compatible: isCompatibleSnapshot(
      item.manifest.tool_version,
      tool,
      currentVersion,
    ),
  }));

  const incompatibleCount = decorated.filter((d) => !d.compatible).length;
  const totalCount = decorated.length;
  const batchLabel =
    incompatibleCount > 0
      ? `Delete stale snapshots (${incompatibleCount})`
      : totalCount > 0
        ? `Delete all snapshots (${totalCount})`
        : null;
  const batchVariant: 'stale' | 'all' | null =
    incompatibleCount > 0 ? 'stale' : totalCount > 0 ? 'all' : null;

  // Per-snapshot delete mutation.
  const deleteOneMutation = useMutation({
        /**
     * Deletes the row selected by the user from the snapshot store.
         * Called by: useMutation option object inside LoadSnapshotDialog.
         * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
         */
    mutationFn: async (filename: string) => {
      const { data } = await deleteSnapshot({
        headers: getAuthHeaders(),
        path: { filename },
        throwOnError: true,
      });
      return data;
    },
        /**
     * Refreshes the list after a successful row-level delete.
         * Called by: useMutation option object inside LoadSnapshotDialog.
         * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
         */
    onSuccess: (_res, filename) => {
      toast.success(`Snapshot deleted.`);
      void queryClient.invalidateQueries({ queryKey: ['snapshots-list', tool] });
      void filename;
    },
        /**
     * Reports delete failures through the shared toast surface.
         * Called by: useMutation option object inside LoadSnapshotDialog.
         * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
         */
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete snapshots.');
    },
  });

  // Batch delete mutation. The variant decides whether to send
  // `incompatible_with` for the stale-only path.
  const deleteBatchMutation = useMutation({
        /**
     * Deletes either stale or all snapshots, depending on the batch action.
         * Called by: useMutation option object inside LoadSnapshotDialog.
         * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
         */
    mutationFn: async ({ variant }: { variant: 'stale' | 'all' }) => {
      const { data } = await batchDeleteSnapshots({
        headers: getAuthHeaders(),
        query: { tool, incompatible_with: variant === 'stale' ? currentVersion : null },
        throwOnError: true,
      });
      return data;
    },
        /**
     * Refreshes the snapshot index after the batch delete completes.
         * Called by: useMutation option object inside LoadSnapshotDialog.
         * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
         */
    onSuccess: (res) => {
      const n = res.deleted.length;
      toast.success(`Deleted ${n} snapshot${n === 1 ? '' : 's'}.`);
      void queryClient.invalidateQueries({ queryKey: ['snapshots-list', tool] });
    },
        /**
     * Reports batch delete failures through the shared toast surface.
         * Called by: useMutation option object inside LoadSnapshotDialog.
         * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
         */
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete snapshots.');
    },
  });

    /**
   * Opens a compatible snapshot or reports that loading is not wired yet.
     * Called by: LoadSnapshotDialog internal event, effect, or helper flow.
     * Why: because load flow helpers need to separate file parsing, compatibility reporting, and selected snapshot hydration.
     */
  const handleOpen = async (filename: string) => {
    if (!onOpenSnapshot) {
      toast.info('Snapshot view coming in the next release.');
      return;
    }
    setOpeningFilename(filename);
    try {
      await onOpenSnapshot(filename);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open snapshot.');
    } finally {
      setOpeningFilename(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4" />
              Saved snapshots
            </DialogTitle>
            <DialogDescription>
              Open or remove previously saved {tool.replace('_', ' ')} snapshots.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1 min-h-0 -mx-1">
            {isLoading && (
              <div className="space-y-2 py-2 px-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}
            {isError && (
              <p className="text-sm text-destructive py-2 px-3">
                Could not load snapshots.
              </p>
            )}
            {!isLoading && !isError && decorated.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 px-3 text-center">
                No saved snapshots for this tool yet.
              </p>
            )}
            {!isLoading && !isError && decorated.length > 0 && (
              <ul className="divide-y">
                {decorated.map(({ item, compatible }) => (
                  <li
                    key={item.filename}
                    className="flex items-center gap-2 px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {item.manifest.title || item.filename}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatCapturedAt(item.manifest.captured_at)}
                        {' · '}
                        {item.manifest.tool_version}
                        {' · '}
                        {formatBytes(item.size_bytes)}
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={`View description for ${item.manifest.title}`}
                      title="View description"
                      onClick={() =>
                        setDescriptionFor({
                          filename: item.filename,
                          title: item.manifest.title || item.filename,
                        })
                      }
                    >
                      <Quote className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-destructive hover:text-destructive"
                      aria-label={`Delete ${item.manifest.title}`}
                      title="Delete snapshot"
                      disabled={deleteOneMutation.isPending}
                      onClick={() => setPendingDelete({ item, compatible })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    {!compatible && (
                      <Badge
                        variant="destructive"
                        className="shrink-0 text-xs font-normal"
                        title={`Saved in ${item.manifest.tool_version}; the current build can't open this snapshot.`}
                      >
                        Incompatible
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={compatible ? 'default' : 'outline'}
                      disabled={!compatible || openingFilename === item.filename}
                      onClick={() => handleOpen(item.filename)}
                      title={
                        compatible
                          ? 'Open this snapshot in read-only view'
                          : `Saved in ${item.manifest.tool_version}. Incompatible with the current build (${currentVersion || 'unknown'}).`
                      }
                    >
                      {openingFilename === item.filename ? 'Opening…' : 'Open'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter className="flex sm:justify-between gap-2">
            <div className="flex-1 flex items-start gap-2 text-xs text-muted-foreground">
              {totalCount > 0 && (
                <>
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {totalCount === 1
                      ? '1 snapshot saved.'
                      : `${totalCount} snapshots saved.`}
                    {incompatibleCount > 0 && (
                      <>
                        {' '}
                        <span className="text-destructive">
                          {incompatibleCount} can't be opened by this build.
                        </span>
                      </>
                    )}
                  </span>
                </>
              )}
            </div>
            {batchLabel && (
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={deleteBatchMutation.isPending}
                onClick={() => setPendingBatchDelete(true)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {batchLabel}
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SnapshotDescriptionDialog
        filename={descriptionFor?.filename ?? null}
        title={descriptionFor?.title ?? ''}
        onClose={() => setDescriptionFor(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete snapshot?"
        description={
          pendingDelete
            ? `"${pendingDelete.item.manifest.title || pendingDelete.item.filename}" ` +
              `(saved ${formatCapturedAt(pendingDelete.item.manifest.captured_at)}, ` +
              `version ${pendingDelete.item.manifest.tool_version}) will be permanently removed. This cannot be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (pendingDelete) {
            deleteOneMutation.mutate(pendingDelete.item.filename);
            setPendingDelete(null);
          }
        }}
      />

      <ConfirmDialog
        open={pendingBatchDelete}
        onOpenChange={setPendingBatchDelete}
        title={
          batchVariant === 'stale'
            ? 'Delete stale snapshots?'
            : 'Delete all snapshots?'
        }
        description={
          batchVariant === 'stale'
            ? `${incompatibleCount} snapshot${incompatibleCount === 1 ? '' : 's'} saved in versions ` +
              `incompatible with the current build (${currentVersion || 'unknown'}) will be permanently removed. ` +
              `Compatible snapshots will be kept.`
            : `All ${totalCount} ${tool.replace('_', ' ')} snapshot${totalCount === 1 ? '' : 's'} will be permanently removed. ` +
              `This cannot be undone.`
        }
        confirmText={batchVariant === 'stale' ? 'Delete stale' : 'Delete all'}
        cancelText="Cancel"
        variant="destructive"
        onConfirm={() => {
          if (batchVariant) {
            deleteBatchMutation.mutate({ variant: batchVariant });
            setPendingBatchDelete(false);
          }
        }}
      />
    </>
  );
}
