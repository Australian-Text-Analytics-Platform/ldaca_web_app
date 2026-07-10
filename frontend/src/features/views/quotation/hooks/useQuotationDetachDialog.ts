import { useState, type SetStateAction } from 'react';

import { analysisTaskDetachOptions } from '@/api';
import type { DetachDialogNodeOption } from '../../common/components/DetachColumnsDialog';
import type { NodeColumnSelection } from '../../common';
import { useDetachColumnsState } from '../../common/hooks/useDetachColumnsState';

type QuotationDetachHandler = (
  nodeId: string,
  selectedColumns: string[],
  materializedPath: string | null,
) => Promise<void> | void;

interface UseQuotationDetachDialogArgs {
  workspaceId: string | null;
  activeSelections: NodeColumnSelection[];
  resolveTaskId: () => Promise<string | null>;
  handleDetach: QuotationDetachHandler;
  materializedPaths: Record<string, string>;
  nodeDetaching: Record<string, boolean>;
  showErrorDialog: (message: string) => void;
}

/** Builds the dialog's initially empty per-node source-column selections. */
/**
 * Called by: useQuotationDetachDialog after the backend returns selectable
 * detach columns because quotation output columns are generated automatically
 * while source columns remain opt-in.
 */
function emptySelectionForOptions(options: DetachDialogNodeOption[]): Record<string, string[]> {
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
 * Flow: open by loading available source columns for the active node/column,
 * confirm by dispatching the task-flow detach handler with selected columns
 * and materialized path, then reset the dialog-local pending state.
 */
export function useQuotationDetachDialog({
  workspaceId,
  activeSelections,
  resolveTaskId,
  handleDetach,
  materializedPaths,
  nodeDetaching,
  showErrorDialog,
}: UseQuotationDetachDialogArgs) {
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [pendingDetachNodeId, setPendingDetachNodeId] = useState<string | null>(null);
  const [detachNodeOptions, setDetachNodeOptions] = useState<DetachDialogNodeOption[]>([]);
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

  /** Opens the detach dialog after loading selectable columns for the node. */
  /**
   * Called by: QuotationNodeBlock actions via QuotationFeature because users
   * can add a node's quotation results back into the workspace.
   * Flow: resolve the active text column, load backend detach options, seed
   * empty source-column selections, then show the dialog or report the error.
   */
  const openDetachDialog = async (nodeId: string) => {
    if (!workspaceId) return;
    const selection = activeSelections.find((item) => item.nodeId === nodeId);
    if (!selection?.column) return;

    try {
      const taskId = await resolveTaskId();
      if (!taskId) throw new Error('No quotation task to detach');
      const { data: response } = await analysisTaskDetachOptions({
        path: { workspace_id: workspaceId, task_id: taskId },
        query: { node_id: nodeId, column: selection.column },
        throwOnError: true,
      });
      const nodes = response.data?.nodes ?? [];
      setPendingDetachNodeId(nodeId);
      setDetachNodeOptions(nodes);
      setSelectedDetachColumns(emptySelectionForOptions(nodes));
      setDetachDialogOpen(true);
    } catch (error) {
      resetDialogState();
      showErrorDialog(
        error instanceof Error ? error.message : 'Failed to load quotation detach options',
      );
    }
  };

  /** Confirms detach with selected source columns and the node's cached path. */
  /**
   * Called by: QuotationDetachDialog because the shared confirm button should
   * turn dialog selections into one quotation workspace-detach request.
   */
  const handleDetachConfirm = async () => {
    if (!pendingDetachNodeId) return;
    const selectedColumns = selectedDetachColumns[pendingDetachNodeId] ?? [];
    await handleDetach(
      pendingDetachNodeId,
      selectedColumns,
      materializedPaths[pendingDetachNodeId] ?? null,
    );
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
