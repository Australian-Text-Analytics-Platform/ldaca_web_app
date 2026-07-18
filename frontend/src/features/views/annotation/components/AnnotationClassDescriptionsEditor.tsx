import { useState } from 'react';
import type { AnnotationClassDescriptionRow } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  normalizeClassDescriptionRows,
  useAnnotationClassDescriptions,
} from '../hooks/useAnnotationClassDescriptions';

// Compact card shows class-name badges; extras collapse into a "+N more" badge
// so the card stays tight while the full list lives in the Edit dialog.
const CLASS_NAME_PREVIEW_LIMIT = 20;

interface AnnotationClassDescriptionsEditorProps {
  workspaceId: string | null;
  nodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
}

/**
 * Compact class summary plus an Edit dialog for the selected Annotation class node.
 *
 * Used by: AnnotationFeature's class-description card because users need to see
 * the configured classes at a glance and edit them (add/rename/delete) before
 * running annotation, without the descriptions cluttering the card.
 *
 * Flow: fetch the selected two-column payload through
 * useAnnotationClassDescriptions, render the class names as compact badges, and
 * expose an Edit dialog with local draft rows. Add/blur/delete persist the full
 * normalized row set and invalidate the workspace node data cache so other
 * table views observe the rewritten node. The Edit trigger stays enabled after
 * annotation starts so reviewers can amend classes on the go.
 */
export function AnnotationClassDescriptionsEditor({
  workspaceId,
  nodeId,
  classColumn,
  descriptionColumn,
}: AnnotationClassDescriptionsEditorProps) {
  const queryClient = useQueryClient();
  const [draftRows, setDraftRows] = useState<AnnotationClassDescriptionRow[] | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const classDescriptions = useAnnotationClassDescriptions({
    workspaceId,
    nodeId,
    classColumn,
    descriptionColumn,
  });

  const savedRows = classDescriptions.rows;
  const editorRows = draftRows ?? savedRows;
  // Compact card display: non-empty class names paired with their (trimmed)
  // descriptions so each chip can show its description in a hover tooltip; capped
  // with a "+N more" badge. Chips without a description render as plain badges.
  const classChips = editorRows
    .map((row) => ({
      name: row.class.trim(),
      description: row.description.trim(),
    }))
    .filter((chip) => chip.name.length > 0);
  const visibleClassChips = classChips.slice(0, CLASS_NAME_PREVIEW_LIMIT);
  const hiddenClassCount = classChips.length - visibleClassChips.length;

  const persistRows = (rows: AnnotationClassDescriptionRow[]) => {
    if (!classDescriptions.canLoad) return;
    const normalized = normalizeClassDescriptionRows(rows);
    setDraftRows(normalized);
    queryClient.setQueryData(classDescriptions.queryKey, { rows: normalized });
    toast.info('Class changes apply to this annotation draft only.');
  };

  const updateDraftCell = (rowIndex: number, field: 'class' | 'description', value: string) => {
    setDraftRows((current) =>
      (current ?? editorRows).map((row, index) =>
        index === rowIndex ? { ...row, [field]: value } : row,
      ),
    );
  };

  const persistDraftCell = (rowIndex: number, field: 'class' | 'description', value: string) => {
    const nextRows = editorRows.map((row, index) =>
      index === rowIndex ? { ...row, [field]: value } : row,
    );
    setDraftRows(nextRows);
    persistRows(nextRows);
  };

  const handleAddClass = () => {
    const nextRows = [...editorRows, { class: '', description: '' }];
    setDraftRows(nextRows);
    persistRows(nextRows);
  };

  // Delete the row at rowIndex and persist the remaining classes (the missing
  // delete affordance this card previously lacked).
  const handleDeleteClass = (rowIndex: number) => {
    const nextRows = editorRows.filter((_, index) => index !== rowIndex);
    setDraftRows(nextRows);
    persistRows(nextRows);
  };

  if (!nodeId) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        Select a class-description node to edit classes.
      </div>
    );
  }

  if (classDescriptions.query.isError) {
    return (
      <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        Could not load class descriptions.
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold">Classes</h3>
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!classDescriptions.canLoad || classDescriptions.query.isLoading}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent
            className="max-w-2xl"
            onOpenAutoFocus={(event) => {
              // Don't drop a cursor into the first class input on open: that
              // would persist a redundant no-op save the moment the user clicks
              // Add/Delete (the blur fires before the click).
              event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit classes</DialogTitle>
              <DialogDescription>
                Add, rename, or remove annotation classes and their descriptions.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {editorRows.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  No classes yet. Use “Add class” to create one.
                </p>
              ) : (
                editorRows.map((row, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Input
                      aria-label={`Class ${String(index + 1)}`}
                      value={row.class}
                      placeholder="Class"
                      className="w-1/3"
                      disabled={false}
                      onChange={(event) => {
                        updateDraftCell(index, 'class', event.target.value);
                      }}
                      onBlur={(event) => {
                        persistDraftCell(index, 'class', event.target.value);
                      }}
                    />
                    <Textarea
                      aria-label={`Description ${String(index + 1)}`}
                      value={row.description}
                      rows={2}
                      placeholder="Description"
                      disabled={false}
                      className="min-h-9 flex-1 resize-y"
                      onChange={(event) => {
                        updateDraftCell(index, 'description', event.target.value);
                      }}
                      onBlur={(event) => {
                        persistDraftCell(index, 'description', event.target.value);
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete class ${String(index + 1)}`}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        handleDeleteClass(index);
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!classDescriptions.canLoad}
                onClick={handleAddClass}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add class
              </Button>
              <DialogClose asChild>
                <Button type="button" size="sm">
                  Done
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {classDescriptions.query.isLoading ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          Loading class descriptions...
        </div>
      ) : classChips.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          No classes yet.
        </div>
      ) : (
        <TooltipProvider delayDuration={120} skipDelayDuration={0}>
          <div className="flex flex-wrap gap-1.5">
            {visibleClassChips.map((chip, index) =>
              // Only classes with a description get a hover tooltip; the trigger
              // is a native span (asChild) so the ref/hover wiring is guaranteed
              // even though Badge is not a forwardRef component.
              chip.description ? (
                <Tooltip key={`${chip.name}-${String(index)}`}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-default">
                      <Badge variant="secondary">{chip.name}</Badge>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs whitespace-normal break-words">
                    {chip.description}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Badge key={`${chip.name}-${String(index)}`} variant="secondary">
                  {chip.name}
                </Badge>
              ),
            )}
            {hiddenClassCount > 0 ? (
              <Badge variant="outline">+{String(hiddenClassCount)} more</Badge>
            ) : null}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
