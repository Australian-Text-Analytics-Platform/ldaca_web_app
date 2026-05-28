import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FolderPlus, Quote } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { importSampleData } from '@/api/generated/sdk.gen';
import type { SampleDataCollection } from '@/api/generated/types.gen';
import {
  getSampleDataCatalogueOptions,
  getSampleDataReadmeOptions,
} from '@/api/generated/@tanstack/react-query.gen';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { DemoSnapshotsTab } from './DemoSnapshotsTab';

const TOOL_LABELS: Record<string, string> = {
  concordance: 'Concordance',
  'token-frequency': 'Token Frequency',
  preprocessing: 'Preprocessing',
  'data-loader': 'Data Loader',
  'topic-modeling': 'Topic Modeling',
  'sequential-analysis': 'Sequential Analysis',
};

/**
 * Formats sample-data collection sizes in the import dialog. Kept local because
 * sample catalogue entries always include concrete byte counts.
 * Used by: local callers in data-loader/SampleDataPanel module.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders local availability for a sample-data collection so users understand
 * which rows are bundled, downloaded, partial, or pending download.
 * Rendered by: data-loader/SampleDataPanel module JSX because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: map backend availability states to compact labels and color classes for the collection row.
 */
function StatusChip({ status }: { status: SampleDataCollection['status'] }) {
  const map: Record<SampleDataCollection['status'], { label: string; className: string }> = {
    bundled: { label: '● Available', className: 'text-green-600 dark:text-green-400' },
    downloaded: { label: '✓ Downloaded', className: 'text-green-600 dark:text-green-400' },
    partial: { label: '⚠ Partial', className: 'text-yellow-600 dark:text-yellow-400' },
    not_downloaded: { label: '○ Not downloaded', className: 'text-muted-foreground' },
  };
  const { label, className } = map[status] ?? map.not_downloaded;
  return <span className={cn('text-xs font-medium whitespace-nowrap', className)}>{label}</span>;
}

/**
 * Finds the collection README file used by the citation viewer. The sample
 * import list calls this per row to decide whether to show the README action.
 * Used by: local callers in data-loader/SampleDataPanel module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
function readmePath(col: SampleDataCollection): string | null {
  return col.files.find((f) => f.path.endsWith('README.md'))?.path ?? null;
}

// ── README viewer ─────────────────────────────────────────────────────────────

interface ReadmeViewerProps {
  path: string | null;
  collectionName: string;
  onClose: () => void;
}

/**
 * Displays collection README markdown so users can inspect sample citations.
 * Rendered by: data-loader/SampleDataPanel module JSX because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: load README markdown for a snapshot, show loading/error states, and render fetched text
 * only after the request resolves.
 */
function ReadmeViewer({ path, collectionName, onClose }: ReadmeViewerProps) {
  const { data, isLoading, isError } = useQuery({
    ...getSampleDataReadmeOptions({
      parseAs: 'text',
      query: { path: path ?? '' },
    }),
    enabled: path !== null,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const content = typeof data === 'string' ? data : '';

  return (
    <Dialog
      open={path !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{collectionName}</DialogTitle>
          <DialogDescription>Dataset README</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 min-h-0">
          {isLoading && (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {isError && <p className="text-sm text-destructive py-2">Could not load README.</p>}
          {!isLoading && !isError && content && (
            <div className="prose prose-sm prose-slate dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  authHeaders: Record<string, string>;
  onImportComplete: () => void;
}

/**
 * Opens the sample-content import workflow from Data Loader. It manages local
 * dataset selection and delegates successful imports back to the parent file
 * browser refresh callback.
 * Rendered by: DemoSnapshotsTab component, DataLoaderFeature module, SnapshotDescriptionDialog component (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: request available sample categories, render snapshot tabs and description dialog, then
 * delegate imports so the Data Loader can refresh files afterward.
 */
export function SampleDataPanel({ authHeaders, onImportComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [viewingReadme, setViewingReadme] = useState<{ path: string; name: string } | null>(null);

  const { data, isLoading, isError } = useQuery({
    ...getSampleDataCatalogueOptions(),
    staleTime: 30_000,
    retry: 1,
    enabled: open,
  });
  const catalogue = data;

  /**
   * Treats bundled collections as always selected. Checkbox rendering and
   * import payload creation both use this helper to stay consistent.
   * Called by: SampleDataPanel internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const getChecked = (col: SampleDataCollection) => {
    if (col.bundled) return true;
    return checked[col.id] ?? false;
  };

  /**
   * Toggles optional remote collections in the dataset import dialog.
   * Called by: SampleDataPanel internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const toggle = (id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  /**
   * Imports selected sample datasets and refreshes the parent file browser once
   * the backend reports the import has started or completed.
   * Called by: SampleDataPanel internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: collect selected IDs, show import progress, call the backend, report remote-download
   * state, refresh files, then reset dialog state.
   */
  const handleImport = async () => {
    const selectedIds = catalogue
      ? catalogue.collections.filter((col) => getChecked(col)).map((col) => col.id)
      : [];

    setImporting(true);
    const loadingToastId = toast.loading('Importing sample data…');
    try {
      const { data: result } = await importSampleData({
        body: { collection_ids: selectedIds },
        headers: authHeaders,
        throwOnError: true,
      });
      toast.dismiss(loadingToastId);
      if (result.remote_download_started) {
        toast.success('Bundled datasets ready.');
        toast.info(
          'Larger datasets are downloading in the background and will appear in the file browser shortly.',
          { duration: 8000 },
        );
      } else {
        toast.success('Sample data imported.');
      }
      onImportComplete();
      setOpen(false);
    } catch (err) {
      toast.dismiss(loadingToastId);
      toast.error((err as Error)?.message || 'Failed to import sample data.');
    } finally {
      setImporting(false);
    }
  };

  const anyChecked = catalogue?.collections.some((col) => getChecked(col)) ?? false;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FolderPlus className="mr-2 h-4 w-4" /> Import sample data
      </Button>

      {/* Import dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import sample content</DialogTitle>
            <DialogDescription>
              Datasets are raw corpora; demo snapshots are pre-built analyses you can open in any
              tool.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="datasets" className="py-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="datasets">Datasets</TabsTrigger>
              <TabsTrigger value="snapshots">Demo snapshots</TabsTrigger>
            </TabsList>

            <TabsContent value="datasets" className="space-y-3">
              {isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              )}

              {!isLoading && catalogue && (
                <div className="rounded-md border divide-y">
                  {catalogue.collections.map((col) => {
                    const readme = readmePath(col);
                    return (
                      <div key={col.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`sdc-${col.id}`}
                            checked={getChecked(col)}
                            disabled={col.bundled}
                            onCheckedChange={() => toggle(col.id)}
                          />
                          <label
                            htmlFor={`sdc-${col.id}`}
                            className="flex-1 text-sm font-medium leading-none cursor-pointer select-none"
                          >
                            {col.name}
                          </label>
                          {readme && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                              aria-label={`View README for ${col.name}`}
                              title="View README"
                              onClick={() => setViewingReadme({ path: readme, name: col.name })}
                            >
                              <Quote className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(col.total_size_bytes)}
                          </span>
                          <StatusChip status={col.status} />
                        </div>
                        {col.recommended_for.length > 0 && (
                          <div className="flex flex-wrap gap-1 pl-6">
                            {col.recommended_for.map((tool) => (
                              <Badge key={tool} variant="secondary" className="text-xs">
                                {TOOL_LABELS[tool] ?? tool}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!isLoading && isError && (
                <p className="text-sm text-muted-foreground">
                  Could not load catalogue. All bundled datasets will be imported.
                </p>
              )}

              <div className="flex justify-end">
                <Button onClick={() => {
                  void handleImport();
                }} disabled={importing || (!isError && !anyChecked)}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  {importing ? 'Importing…' : 'Import selected'}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="snapshots">
              <DemoSnapshotsTab
                authHeaders={authHeaders}
                onImportComplete={() => {
                  /* keep dialog open; the toast confirms */
                }}
                enabled={open}
              />
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={importing}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* README viewer — opens on top of the import dialog */}
      <ReadmeViewer
        path={viewingReadme?.path ?? null}
        collectionName={viewingReadme?.name ?? ''}
        onClose={() => setViewingReadme(null)}
      />
    </>
  );
}
