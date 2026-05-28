import { useCallback, useState } from 'react';
import type { DetachDialogNodeOption } from '../components/DetachColumnsDialog';

export interface UseDetachColumnsStateResult {
  /** Per-node-id list of columns currently checked. */
  selectedDetachColumns: Record<string, string[]>;
  /** Imperative override (e.g. when restoring lock state). */
  setSelectedDetachColumns: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  /** Toggle one column on one node. Set-based so duplicates can't sneak in. */
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
  /** Select every available, non-disabled column across all nodes. */
  selectAllDetachColumns: () => void;
  /** Empty selection for every node. */
  deselectAllDetachColumns: () => void;
  /** Drop everything (used when the dialog closes). */
  resetDetachColumns: () => void;
}

/**
 * Encapsulates the detach-columns-dialog selection logic that was duplicated
 * verbatim in concordance, quotation, and topic-modeling.
 *
 * `detachNodeOptions` is read fresh on every "select all" / "deselect all"
 * call (it's typically populated asynchronously when the user opens the
 * dialog), so callers don't need to memoise it.
 * Used by: concordance, quotation, and topic-modeling detach-column dialogs because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export const useDetachColumnsState = (
  detachNodeOptions: DetachDialogNodeOption[],
): UseDetachColumnsStateResult => {
  const [selectedDetachColumns, setSelectedDetachColumns] = useState<Record<string, string[]>>({});

  const toggleDetachColumn = useCallback((nodeId: string, column: string, checked: boolean) => {
    setSelectedDetachColumns((prev) => {
      const current = new Set(prev[nodeId] ?? []);
      if (checked) current.add(column);
      else current.delete(column);
      return { ...prev, [nodeId]: Array.from(current) };
    });
  }, []);

  const selectAllDetachColumns = useCallback(() => {
    setSelectedDetachColumns((prev) => {
      const next = { ...prev };
      for (const node of detachNodeOptions) {
        const disabled = new Set(node.disabled_columns ?? []);
        next[node.node_id] = node.available_columns.filter((column) => !disabled.has(column));
      }
      return next;
    });
  }, [detachNodeOptions]);

  const deselectAllDetachColumns = useCallback(() => {
    setSelectedDetachColumns((prev) => {
      const next = { ...prev };
      for (const node of detachNodeOptions) {
        next[node.node_id] = [];
      }
      return next;
    });
  }, [detachNodeOptions]);

  const resetDetachColumns = useCallback(() => {
    setSelectedDetachColumns({});
  }, []);

  return {
    selectedDetachColumns,
    setSelectedDetachColumns,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
    resetDetachColumns,
  };
};
