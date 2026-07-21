import { useState, type SetStateAction } from 'react';

import type { DetachNodeOption } from '@/api';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import { useDetachColumnsState } from '../../common/hooks/useDetachColumnsState';

type QuotationDetachHandler = (nodeId: string, selectedColumns: string[]) => Promise<void> | void;

interface UseQuotationDetachDialogArgs {
  activeSelections: NodeColumnSelection[];
  originalColumnsByNode: Record<string, string[]>;
  handleDetach: QuotationDetachHandler;
  nodeDetaching: Record<string, boolean>;
}

/** Builds the dialog's initially empty per-node source-column selections. */
/**
 * Called by: useQuotationDetachDialog when a quotation result is ready for
 * detachment. The source node's current columns are already available in the
 * feature state, so opening the dialog is a local operation rather than an
 * extra API request.
 */
function emptySelectionForOptions(options: DetachNodeOption[]): Record<string, string[]> {
  const initial: Record<string, string[]> = {};
  options.forEach((node) => {
    initial[node.node_id] = [];
  });
  return initial;
}

/**
 * Owns the quotation detach dialog's transient state.
 * Used by: QuotationFeature so the feature component can keep task lifecycle,
 * parameter state, and result rendering separate from dialog option loading
 * and source-column checklist state.
 * Flow: open from the active node selection, seed the source-column checklist,
 * confirm by dispatching the canonical detachment request, then reset the
 * dialog-local pending state.
 */
export function useQuotationDetachDialog({
  activeSelections,
  originalColumnsByNode,
  handleDetach,
  nodeDetaching,
}: UseQuotationDetachDialogArgs) {
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodeId, setPendingDetachNodeId] = useState<string | null>(null);
  const [detachNodeOptions, setDetachNodeOptions] = useState<DetachNodeOption[]>([]);
  const {
    selectedDetachColumns,
    setSelectedDetachColumns,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
  } = useDetachColumnsState(detachNodeOptions);

  const resetDialogState = () => {
    setDetachDialogOpen(false);
    setPendingDetachNodeId(null);
    setDetachNodeOptions([]);
    setSelectedDetachColumns({});
  };

  /** Opens the detach dialog using the columns already loaded for the node. */
  /**
   * Called by: QuotationNodeBlock actions via QuotationFeature because users
   * can add a node's quotation results back into the workspace.
   * Flow: resolve the active text column, build one local option from the
   * source-node metadata, seed empty source-column selections, then show the
   * dialog.
   */
  const openDetachDialog = (nodeId: string) => {
    const selection = activeSelections.find((item) => item.nodeId === nodeId);
    if (!selection?.column) return;
    const nodes: DetachNodeOption[] = [
      {
        node_id: nodeId,
        node_name: nodeId,
        text_column: selection.column,
        available_columns: originalColumnsByNode[nodeId] ?? [selection.column],
      },
    ];
    setPendingDetachNodeId(nodeId);
    setDetachNodeOptions(nodes);
    setSelectedDetachColumns(emptySelectionForOptions(nodes));
    setDetachDialogOpen(true);
  };

  /** Confirms detach with the selected source columns. */
  /**
   * Called by: QuotationFeature's shared DetachColumnsDialog because its
   * confirm button turns selections into one quotation workspace-detach request.
   */
  const handleDetachConfirm = async () => {
    if (!pendingDetachNodeId) return;
    const selectedColumns = selectedDetachColumns[pendingDetachNodeId] ?? [];
    await handleDetach(pendingDetachNodeId, selectedColumns);
    resetDialogState();
  };

  const onOpenChange = (nextOpen: SetStateAction<boolean>) => {
    const open = typeof nextOpen === 'function' ? nextOpen(detachDialogOpen) : nextOpen;
    if (open) {
      setDetachDialogOpen(true);
      return;
    }
    resetDialogState();
  };

  return {
    openDetachDialog,
    detachDialog: {
      open: detachDialogOpen,
      onOpenChange,
      isDetaching: Boolean(pendingDetachNodeId && nodeDetaching[pendingDetachNodeId]),
      detachNodeOptions,
      selectedDetachColumns,
      toggleDetachColumn,
      selectAllDetachColumns,
      deselectAllDetachColumns,
      handleDetachConfirm,
    },
  };
}
