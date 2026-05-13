import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FolderPlus, Quote } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { filesApi, type SampleDataCollection, type SampleDataCollectionStatus } from '@/api/files';
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
import { cn } from '@/lib/utils';

const TOOL_LABELS: Record<string, string> = {
  'concordance': 'Concordance',
  'token-frequency': 'Token Frequency',
  'preprocessing': 'Preprocessing',
  'data-loader': 'Data Loader',
  'topic-modeling': 'Topic Modeling',
  'sequential-analysis': 'Sequential Analysis',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusChip({ status }: { status: SampleDataCollectionStatus }) {
  const map: Record<SampleDataCollectionStatus, { label: string; className: string }> = {
    bundled:        { label: '● Available',      className: 'text-green-600 dark:text-green-400' },
    downloaded:     { label: '✓ Downloaded',     className: 'text-green-600 dark:text-green-400' },
    partial:        { label: '⚠ Partial',        className: 'text-yellow-600 dark:text-yellow-400' },
    not_downloaded: { label: '○ Not downloaded', className: 'text-muted-foreground' },
  };
  const { label, className } = map[status] ?? map.not_downloaded;
  return <span className={cn('text-xs font-medium whitespace-nowrap', className)}>{label}</span>;
}

function readmePath(col: SampleDataCollection): string | null {
  return col.files.find((f) => f.path.endsWith('README.md'))?.path ?? null;
}

// ── README viewer ─────────────────────────────────────────────────────────────

interface ReadmeViewerProps {
  path: string | null;
  collectionName: string;
  authHeaders: Record<string, string>;
  onClose: () => void;
}

const ReadmeViewer: React.FC<ReadmeViewerProps> = ({ path, collectionName, authHeaders, onClose }) => {
  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['sample-data-readme', path],
    queryFn: () => filesApi.getSampleDataReadme(path!, authHeaders),
    enabled: path !== null,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  return (
    <Dialog open={path !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
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
          {isError && (
            <p className="text-sm text-destructive py-2">Could not load README.</p>
          )}
          {!isLoading && !isError && content && (
            <div className="prose prose-sm prose-slate dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  authHeaders: Record<string, string>;
  onImportComplete: () => void;
}

export const SampleDataPanel: React.FC<Props> = ({ authHeaders, onImportComplete }) => {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [viewingReadme, setViewingReadme] = useState<{ path: string; name: string } | null>(null);

  const { data: catalogue, isLoading, isError } = useQuery({
    queryKey: ['sample-data-catalogue'],
    queryFn: () => filesApi.getSampleDataCatalogue(authHeaders),
    staleTime: 30_000,
    retry: 1,
    enabled: open,
  });

  const getChecked = (col: SampleDataCollection) => {
    if (col.bundled) return true;
    return checked[col.id] ?? false;
  };

  const toggle = (id: string) =>
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleImport = async () => {
    const selectedIds = catalogue
      ? catalogue.collections.filter((col) => getChecked(col)).map((col) => col.id)
      : [];

    setImporting(true);
    const loadingToastId = toast.loading('Importing sample data…');
    try {
      const result = await filesApi.importSampleData(selectedIds, authHeaders);
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
      await onImportComplete();
      setOpen(false);
    } catch (err) {
      toast.dismiss(loadingToastId);
      toast.error((err as Error)?.message || 'Failed to import sample data.');
      console.error('[SampleDataPanel] import failed', err);
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
            <DialogTitle>Import sample data</DialogTitle>
            <DialogDescription>
              Select the datasets you want to import. Bundled datasets are copied instantly; larger remote datasets download in the background.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
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
                        <span className="text-xs text-muted-foreground">{formatBytes(col.total_size_bytes)}</span>
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={importing}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing || (!isError && !anyChecked)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              {importing ? 'Importing…' : 'Import selected'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* README viewer — opens on top of the import dialog */}
      <ReadmeViewer
        path={viewingReadme?.path ?? null}
        collectionName={viewingReadme?.name ?? ''}
        authHeaders={authHeaders}
        onClose={() => setViewingReadme(null)}
      />
    </>
  );
};
