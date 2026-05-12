/**
 * Phase 4.6 (post-launch follow-up): manage hidden derived analytic columns
 * on a node.
 *
 * The node may carry several derivations (e.g. ``__derived__.tokens.text.jieba``
 * and ``__derived__.tokens.text.bert-base-uncased`` coexisting after the user
 * tokenised the same source under two different models). Analyses today
 * pick "the first matching entry" via ``Node.find_derived_column(form=tokens)``,
 * which is insertion-order — there's no UI to pick. This dialog lets users
 * delete a wrong entry (e.g. Chinese column accidentally tokenised with an
 * English model) without touching the API directly.
 *
 * Each row shows ``form: source · model (language)`` and a Delete button.
 * Delete calls the existing ``DELETE /workspaces/nodes/{id}/derived/{column}``
 * endpoint, then invalidates both ``nodeInfo`` and ``workspaceGraph`` so the
 * inspector chip and downstream analyses (concordance tokens-mode picker,
 * frequency engine routing) read the new state immediately.
 */
import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { nodesApi } from '@/api/nodes';
import { parseDerivedColumn, type DerivedColumnMeta } from '@/types';
import { languageLabel } from '@/lib/languages';

export interface DerivedColumnsDialogProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  nodeName: string;
  /**
   * Per-derived-column metadata mirrored from the backend. Sorted by
   * column name on the way in (the inspector already does this), so
   * the rendered order is stable.
   */
  derived: Record<string, DerivedColumnMeta>;
  /** Called after every successful delete so the caller can refresh queries. */
  onDeleted?: (column: string) => void;
}

export function DerivedColumnsDialog({
  open,
  onClose,
  nodeId,
  nodeName,
  derived,
  onDeleted,
}: DerivedColumnsDialogProps) {
  const { getAuthHeaders } = useAuth();
  // Track which row is being deleted so we can show a spinner and lock
  // the corresponding button without blocking the whole dialog.
  const [deletingColumn, setDeletingColumn] = useState<string | null>(null);

  const entries = Object.entries(derived);

  const handleDelete = async (column: string, meta: DerivedColumnMeta) => {
    setDeletingColumn(column);
    try {
      await nodesApi.deleteDerivedColumn(nodeId, column, getAuthHeaders());
      const parsed = parseDerivedColumn(column);
      const summary = parsed
        ? `${parsed.form}: ${parsed.source} · ${parsed.model}`
        : column;
      toast.success(`Removed ${summary}`);
      onDeleted?.(column);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to remove ${meta.model}: ${message}`);
    } finally {
      setDeletingColumn(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage derived columns on “{nodeName}”</DialogTitle>
          <DialogDescription>
            Hidden tokenisation columns drive concordance tokens-mode,
            frequency analysis, and language inference. Remove a wrong
            tokenisation (e.g. Chinese text tokenised with an English
            model) here.
          </DialogDescription>
        </DialogHeader>

        {entries.length === 0 ? (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
            No derived columns on this node.
          </div>
        ) : (
          <ul className="space-y-2">
            {entries.map(([column, meta]) => {
              const parsed = parseDerivedColumn(column);
              const isDeleting = deletingColumn === column;
              return (
                <li
                  key={column}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-sm">
                      {parsed
                        ? `${parsed.form}: ${parsed.source} · ${parsed.model}`
                        : column}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      language: {meta.language ? languageLabel(meta.language) : 'unspecified'}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(column, meta)}
                    disabled={isDeleting || deletingColumn !== null}
                    aria-label={`Delete derived column ${column}`}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-destructive" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DerivedColumnsDialog;
