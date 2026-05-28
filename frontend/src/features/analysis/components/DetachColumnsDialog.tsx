import type { Dispatch, SetStateAction } from 'react';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip';

export type DetachDialogNodeOption = {
  node_id: string;
  node_name: string;
  available_columns: string[];
  disabled_columns?: string[];
  /** Column the analysis ran on. Bolded in the column list so it
   * stands out from sibling metadata columns. */
  text_column?: string | null;
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
  /** When set, the confirm button is disabled and the string is shown
   * as a hover tooltip explaining why. Callers opt in per analysis
   * tool — e.g. topic modelling needs a metadata column selected
   * (its only mandatory output is the topic number), but concordance
   * and quotation already include useful mandatory columns and can
   * detach with no optional column ticked. */
  confirmDisabledReason?: string;
};

/**
 * Renders the shared detach-columns confirmation dialog used by analysis tools
 * that can materialize selected optional columns into the workspace.
 * Used by: concordance, quotation, and topic-modeling detach flows because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
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
  confirmDisabledReason,
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

  const isDetachDisabled = isDetaching || Boolean(confirmDisabledReason);

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
          {detachNodeOptions.map((node) => {
            // Mandatory columns are hidden from the dialog across every tool:
            // the backend always includes them in the detach output, so
            // surfacing them as greyed-out "(required)" checkboxes is just
            // visual noise. The dispersion-detach dialog already drops them
            // upstream; this branch handles the per-hit detach dialog the
            // same way.
            const disabledSet = new Set(node.disabled_columns || []);
            const optionalColumns = node.available_columns.filter(
              (column) => !disabledSet.has(column),
            );
            if (optionalColumns.length === 0) return null;
            return (
              <div key={node.node_id} className="rounded-md border p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">{node.node_name}</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {optionalColumns.map((column) => {
                    const checked = (selectedDetachColumns[node.node_id] || []).includes(column);
                    const isAnalysisColumn = column === node.text_column;
                    return (
                      <label key={`${node.node_id}-${column}`} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value: boolean | 'indeterminate') => toggleDetachColumn(node.node_id, column, value === true)}
                          disabled={isDetaching}
                        />
                        <span className={isAnalysisColumn ? 'font-semibold' : undefined}>{column}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDetaching}>Cancel</AlertDialogCancel>
          <DisabledReasonTooltip reason={confirmDisabledReason}>
            <Button asChild size="sm" disabled={isDetachDisabled}>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDetachConfirm();
                }}
                disabled={isDetachDisabled}
              >
                {isDetaching ? (
                  <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Adding to Workspace…</span>
                ) : (
                  <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" />Add to Workspace</span>
                )}
              </AlertDialogAction>
            </Button>
          </DisabledReasonTooltip>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
