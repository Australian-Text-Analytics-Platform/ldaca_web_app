/**
 * Demo-snapshots tab inside <SampleDataPanel>'s import dialog.
 *
 * Mirrors the structure of the sibling datasets tab, but talks to the
 * ``/files/demo-snapshots/...`` endpoints. Each entry is a single
 * ``.ldaca-snapshot`` bundle that lands in the user's snapshot folder
 * on import — once imported, the bundle shows up in the per-tool Load
 * dialog without further wiring.
 *
 * Conflict policy (set by the user in conversation):
 *   - ``not_downloaded``: standard checkbox, default unchecked.
 *   - ``downloaded``: checkbox disabled (matching local copy exists).
 *   - ``conflict``: checkbox disabled by default; a per-row "Replace
 *     local copy" toggle opts the user in to a destructive replace.
 *
 * On a successful import we invalidate every ``snapshots-list`` query
 * so each tool's Load button picks up the new bundles immediately.
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FolderPlus, AlertTriangle } from 'lucide-react';
import { filesApi, type DemoSnapshotEntryView } from '@/lib/backend/files';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const TOOL_LABELS: Record<string, string> = {
  concordance: 'Concordance',
  quotation: 'Quotation',
  token_frequencies: 'Token Frequency',
  sequential_analysis: 'Trends',
  topic_modeling: 'Topic Modelling',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusChip({ status }: { status: DemoSnapshotEntryView['status'] }) {
  const map: Record<DemoSnapshotEntryView['status'], { label: string; className: string }> = {
    downloaded: { label: '✓ Downloaded', className: 'text-green-600 dark:text-green-400' },
    not_downloaded: { label: '○ Not downloaded', className: 'text-muted-foreground' },
    conflict: { label: '⚠ Conflict', className: 'text-amber-600 dark:text-amber-400' },
  };
  const { label, className } = map[status];
  return <span className={cn('text-xs font-medium whitespace-nowrap', className)}>{label}</span>;
}

interface Props {
  authHeaders: Record<string, string>;
  /** Called on successful import so the parent dialog can dismiss. */
  onImportComplete: () => void;
  /** Controls whether the catalogue is fetched. Mirrors the dataset
   * tab's lazy fetch — only loads when the dialog is open. */
  enabled: boolean;
}

export const DemoSnapshotsTab: React.FC<Props> = ({
  authHeaders,
  onImportComplete,
  enabled,
}) => {
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [replace, setReplace] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);

  const { data: catalogue, isLoading, isError, refetch } = useQuery({
    queryKey: ['demo-snapshots-catalogue'],
    queryFn: () => filesApi.getDemoSnapshotsCatalogue(authHeaders),
    staleTime: 30_000,
    retry: 1,
    enabled,
  });

  const snapshots = catalogue?.snapshots ?? [];

  const isRowToggleable = (s: DemoSnapshotEntryView): boolean => {
    if (s.status === 'downloaded') return false;
    if (s.status === 'conflict') return Boolean(replace[s.id]);
    return true;
  };

  const toggleChecked = (s: DemoSnapshotEntryView) => {
    if (!isRowToggleable(s)) return;
    setChecked((prev) => ({ ...prev, [s.id]: !prev[s.id] }));
  };

  const toggleReplace = (s: DemoSnapshotEntryView) => {
    setReplace((prev) => {
      const next = !prev[s.id];
      // Toggling replace off also unticks the row — keeps the
      // selection state honest.
      if (!next) {
        setChecked((c) => ({ ...c, [s.id]: false }));
      }
      return { ...prev, [s.id]: next };
    });
  };

  const selectedIds = snapshots
    .filter((s) => checked[s.id])
    .map((s) => s.id);
  const replaceIds = selectedIds.filter((id) => replace[id]);

  const handleImport = async () => {
    if (selectedIds.length === 0) return;
    setImporting(true);
    const loadingToastId = toast.loading('Importing demo snapshots…');
    try {
      const result = await filesApi.importDemoSnapshots(selectedIds, replaceIds, authHeaders);
      toast.dismiss(loadingToastId);

      const imported = result.results.filter((r) => r.status === 'imported' || r.status === 'replaced').length;
      const skipped = result.results.filter(
        (r) => r.status === 'skipped_existing' || r.status === 'skipped_conflict',
      ).length;
      const failed = result.results.filter((r) => r.status === 'failed');

      if (imported > 0) {
        toast.success(`${imported} demo snapshot${imported === 1 ? '' : 's'} imported.`);
      }
      if (skipped > 0) {
        toast.info(`${skipped} skipped (already present or conflicting).`, { duration: 6000 });
      }
      if (failed.length > 0) {
        toast.error(
          `${failed.length} failed: ${failed.map((f) => f.message ?? f.id).join('; ')}`,
          { duration: 10000 },
        );
      }

      // Invalidate every per-tool snapshot list so the Load buttons
      // refresh without a page reload.
      await queryClient.invalidateQueries({ queryKey: ['snapshots-list'] });
      // Re-fetch our own catalogue so freshly-imported rows flip to
      // ``downloaded`` next time the dialog opens.
      await refetch();

      setChecked({});
      setReplace({});
      if (imported > 0 || (skipped > 0 && failed.length === 0)) {
        onImportComplete();
      }
    } catch (err) {
      toast.dismiss(loadingToastId);
      toast.error((err as Error)?.message || 'Failed to import demo snapshots.');
    } finally {
      setImporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2 py-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Could not load demo-snapshot catalogue.
      </p>
    );
  }

  if (snapshots.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        No demo snapshots are available yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border divide-y">
        {snapshots.map((s) => {
          const toolLabel = TOOL_LABELS[s.tool] ?? s.tool;
          const conflict = s.status === 'conflict';
          const rowChecked = checked[s.id] ?? false;
          return (
            <div key={s.id} className="flex flex-col gap-1.5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`dsnap-${s.id}`}
                  checked={rowChecked}
                  disabled={!isRowToggleable(s)}
                  onCheckedChange={() => toggleChecked(s)}
                />
                <label
                  htmlFor={`dsnap-${s.id}`}
                  className={cn(
                    'flex-1 text-sm font-medium leading-none select-none',
                    isRowToggleable(s) ? 'cursor-pointer' : 'cursor-not-allowed',
                  )}
                >
                  {s.name}
                </label>
                <span className="text-xs text-muted-foreground">{formatBytes(s.size)}</span>
                <StatusChip status={s.status} />
              </div>
              {s.description && (
                <p className="pl-6 text-xs text-muted-foreground">{s.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-1 pl-6">
                <Badge variant="secondary" className="text-xs">{toolLabel}</Badge>
                {s.recommended_dataset && (
                  <Badge variant="outline" className="text-xs">
                    Pairs with {s.recommended_dataset}
                  </Badge>
                )}
              </div>
              {conflict && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 dark:border-amber-900/60 dark:bg-amber-950/40 ml-6">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <div className="flex flex-1 flex-col gap-1.5 text-xs">
                    <span className="text-amber-700 dark:text-amber-300">
                      A local snapshot named <code className="font-mono text-[0.7rem]">{s.filename}</code> exists but differs from the demo.
                    </span>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-amber-700 dark:text-amber-300">
                      <Checkbox
                        id={`dsnap-replace-${s.id}`}
                        checked={Boolean(replace[s.id])}
                        onCheckedChange={() => toggleReplace(s)}
                      />
                      <span>Replace local copy and re-download</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-end">
        <Button
          onClick={handleImport}
          disabled={importing || selectedIds.length === 0}
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          {importing
            ? 'Importing…'
            : `Import ${selectedIds.length > 0 ? `(${selectedIds.length})` : 'selected'}`}
        </Button>
      </div>
    </div>
  );
};
