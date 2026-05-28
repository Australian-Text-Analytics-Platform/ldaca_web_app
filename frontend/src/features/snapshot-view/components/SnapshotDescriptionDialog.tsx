import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { getSnapshotDescription } from '@/api/generated/sdk.gen';

export interface SnapshotDescriptionDialogProps {
  /** When non-null, the dialog is open and fetching this filename's
   * description sidecar. Pass null to close. */
  filename: string | null;
  /** Display title shown in the dialog header (the snapshot's
   * user-chosen title, not the on-disk filename). */
  title: string;
  onClose: () => void;
}

/**
 * Sub-dialog inside the load dialog: renders the snapshot's
 * ``.md`` description sidecar via react-markdown. Mirrors the
 * ``ReadmeViewer`` pattern from ``SampleDataPanel`` so the UX feels
 * the same across imports and snapshot loads.
 * Rendered by: LoadSnapshotDialog component, index module, SampleDataPanel component (rg call sites/imports).
 * Why: because snapshot loaders and sample panels need a compact metadata surface before users decide to inspect or load a snapshot.
 * Flow: fetch the markdown sidecar, render loading/error fallbacks, then show the parsed description in a modal.
 */
export function SnapshotDescriptionDialog({
  filename,
  title,
  onClose,
}: SnapshotDescriptionDialogProps) {
  const { getAuthHeaders } = useAuth();
  const {
    data: content,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['snapshot-description', filename],
    /**
     * Fetches markdown description text for the selected snapshot row.
     * Called by: useQuery option object inside SnapshotDescriptionDialog.
     * Why: because snapshot loaders and sample panels need a compact metadata surface before users decide to inspect or load a snapshot.
     */
    queryFn: async () => {
      const { data } = await getSnapshotDescription({
        headers: getAuthHeaders(),
        parseAs: 'text',
        path: { filename: filename! },
        throwOnError: true,
      });
      return data as string;
    },
    enabled: filename !== null,
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <Dialog
      open={filename !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Snapshot description</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 min-h-0">
          {isLoading && (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}
          {isError && <p className="text-sm text-destructive py-2">Could not load description.</p>}
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
