import type { Dispatch, SetStateAction } from 'react';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import { Checkbox } from '../../../components/ui/checkbox';

export type DetachDialogNodeOption = {
  node_id: string;
  node_name: string;
  available_columns: string[];
  disabled_columns?: string[];
};

type DetachColumnsDialogProps = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isDetaching: boolean;
  title: string;
  description: string;
  detachNodeOptions: DetachDialogNodeOption[];
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
  selectAllDetachColumns: () => void;
  deselectAllDetachColumns: () => void;
  handleDetachConfirm: () => Promise<void> | void;
};

export function DetachColumnsDialog({
  open,
  onOpenChange,
  isDetaching,
  title,
  description,
  detachNodeOptions,
  selectedDetachColumns,
  toggleDetachColumn,
  selectAllDetachColumns,
  deselectAllDetachColumns,
  handleDetachConfirm,
}: DetachColumnsDialogProps) {
  const canSelectAll = detachNodeOptions.some((node) => {
    const disabled = new Set(node.disabled_columns || []);
    const selected = new Set(selectedDetachColumns[node.node_id] || []);
    return node.available_columns.some((column) => !disabled.has(column) && !selected.has(column));
  });
  const canDeselectAll = detachNodeOptions.some((node) => {
    const disabled = new Set(node.disabled_columns || []);
    const selected = new Set(selectedDetachColumns[node.node_id] || []);
    return node.available_columns.some((column) => !disabled.has(column) && selected.has(column));
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={deselectAllDetachColumns}
            disabled={isDetaching || !canDeselectAll}
          >
            Deselect all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={selectAllDetachColumns}
            disabled={isDetaching || !canSelectAll}
          >
            Select all
          </Button>
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {detachNodeOptions.map((node) => (
            <div key={node.node_id} className="rounded-md border p-3">
              <div className="mb-2 text-sm font-semibold text-foreground">{node.node_name}</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {node.available_columns.map((column) => {
                  const disabled = (node.disabled_columns || []).includes(column);
                  const checked = disabled || (selectedDetachColumns[node.node_id] || []).includes(column);
                  return (
                    <label key={`${node.node_id}-${column}`} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value: boolean | 'indeterminate') => toggleDetachColumn(node.node_id, column, value === true)}
                        disabled={disabled || isDetaching}
                      />
                      <span>{column}{disabled ? ' (required)' : ''}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDetaching}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDetachConfirm();
            }}
            disabled={isDetaching}
          >
            {isDetaching ? (
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Adding to Workspace…</span>
            ) : (
              <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" />Add to Workspace</span>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
