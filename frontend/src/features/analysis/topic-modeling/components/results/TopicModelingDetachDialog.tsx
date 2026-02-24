import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../../../components/ui/alert-dialog';
import { Checkbox } from '../../../../../components/ui/checkbox';
import { Loader2 } from 'lucide-react';

type DetachNodeOption = {
  node_id: string;
  node_name: string;
  available_columns: string[];
  disabled_columns?: string[];
};

type Props = {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  isDetaching: boolean;
  detachNodeOptions: DetachNodeOption[];
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
  handleDetachConfirm: () => Promise<void> | void;
};

export function TopicModelingDetachDialog({
  open,
  onOpenChange,
  isDetaching,
  detachNodeOptions,
  selectedDetachColumns,
  toggleDetachColumn,
  handleDetachConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Detach Topic Results</AlertDialogTitle>
          <AlertDialogDescription>
            Select metadata columns to include with the detached topic column. Existing source <code>topic</code> columns are shown but cannot be selected.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {detachNodeOptions.map((node) => (
            <div key={node.node_id} className="rounded-md border p-3">
              <div className="mb-2 text-sm font-semibold text-foreground">{node.node_name}</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {node.available_columns.map((column) => {
                  const disabled = (node.disabled_columns || []).includes(column);
                  const checked = (selectedDetachColumns[node.node_id] || []).includes(column);
                  return (
                    <label key={`${node.node_id}-${column}`} className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value: boolean | 'indeterminate') => toggleDetachColumn(node.node_id, column, value === true)}
                        disabled={disabled || isDetaching}
                      />
                      <span>{column}{disabled ? ' (disabled)' : ''}</span>
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
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Detaching…</span>
            ) : (
              'Detach'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
