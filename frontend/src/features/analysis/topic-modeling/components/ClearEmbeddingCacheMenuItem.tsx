import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  clearTopicModelingEmbeddingCache,
  getTopicModelingEmbeddingCacheSize,
} from '@/api/generated/sdk.gen';
import { useAuth } from '@/hooks/useAuth';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatBytes } from '@/lib/utils';

/**
 * Rendered by: Sidebar. Sidebar menu entry that opens a confirm dialog showing the topic-modelling because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * embedding cache size and lets the user clear it.
 *
 * Self-contained: owns its dialog state, fetches the cache size on open, and
 * runs the clear mutation on confirm. Replaces ~50 LoC of topic-modelling
 * business logic that previously lived in the layout Sidebar component.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function ClearEmbeddingCacheMenuItem() {
  const { getAuthHeaders } = useAuth();
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<{ bytes: number; files: number } | null>(null);

  // Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
  // Called by: ClearEmbeddingCacheMenuItem dropdown item to open the dialog and fetch cache stats because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
  const openDialog = async () => {
    setStats(null);
    setOpen(true);
    try {
      const { data: resp } = await getTopicModelingEmbeddingCacheSize({
        headers: getAuthHeaders(),
        throwOnError: true,
      });
      setStats(resp.data ?? null);
    } catch {
      // Leave stats null; dialog will show a generic warning without sizes.
    }
  };

  // Called by: ClearEmbeddingCacheMenuItem confirm dialog because users need a guarded cache delete with reclaimed-size feedback. Flow: close the dialog, call the clear-cache endpoint, toast empty or reclaimed-file results, then surface failures.
  const handleConfirm = async () => {
    setOpen(false);
    try {
      const { data: resp } = await clearTopicModelingEmbeddingCache({
        headers: getAuthHeaders(),
        throwOnError: true,
      });
      const freed = resp.data?.bytes_freed ?? 0;
      const files = resp.data?.files_removed ?? 0;
      if (files === 0) {
        toast('Embedding cache was already empty.');
      } else {
        toast(`Cleared ${files} cached embedding ${files === 1 ? 'file' : 'files'} (${formatBytes(freed)} reclaimed).`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to clear embedding cache.');
    }
  };

  const description = (() => {
    if (stats === null) return 'Calculating size of cached embeddings…\n\n';
    if (stats.files === 0) return 'The embedding cache is currently empty — nothing to clear.\n\n';
    return `${stats.files} cached embedding ${stats.files === 1 ? 'file' : 'files'} will be deleted, freeing ${formatBytes(stats.bytes)} of disk space.\n\n`;
  })() + 'Topic modelling caches per-document embeddings so re-running on the same texts is fast. Clearing this cache means future topic modelling on those texts will need to recompute every embedding from scratch and may take noticeably longer (especially for large corpora).';

  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          void openDialog();
        }}
        className="text-xs text-muted-foreground focus:text-foreground"
      >
        <Trash2 className="mr-2 h-3.5 w-3.5" />
        Clear embedding cache
      </DropdownMenuItem>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Clear embedding cache?"
        description={description}
        confirmText="Clear cache"
        cancelText="Cancel"
        onConfirm={handleConfirm}
        variant="destructive"
      />
    </>
  );
}