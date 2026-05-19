import type { Dispatch, SetStateAction } from 'react';

import {
  DetachColumnsDialog,
  type DetachDialogNodeOption,
} from '@/features/analysis/components/DetachColumnsDialog';

type Props = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isDetaching: boolean;
  detachNodeOptions: DetachDialogNodeOption[];
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
  selectAllDetachColumns: () => void;
  deselectAllDetachColumns: () => void;
  handleDetachConfirm: () => Promise<void> | void;
};

export function TopicModelingDetachDialog({
  open,
  onOpenChange,
  isDetaching,
  detachNodeOptions,
  selectedDetachColumns,
  toggleDetachColumn,
  selectAllDetachColumns,
  deselectAllDetachColumns,
  handleDetachConfirm,
}: Props) {
  // Topic modelling's only mandatory output column is the topic number,
  // which is meaningless without metadata to join against. Block the
  // detach until the user picks at least one optional column per
  // displayed node so the resulting workspace block actually carries
  // analyzable context. Other tools (concordance, quotation) have
  // meaningful mandatory columns of their own and don't need this gate.
  const confirmDisabledReason = (() => {
    if (detachNodeOptions.length === 0) return undefined;
    const allHaveSelection = detachNodeOptions.every((node) => {
      const disabled = new Set(node.disabled_columns || []);
      const optionalColumns = node.available_columns.filter((column) => !disabled.has(column));
      if (optionalColumns.length === 0) return true;
      const selected = new Set(selectedDetachColumns[node.node_id] || []);
      return optionalColumns.some((column) => selected.has(column));
    });
    return allHaveSelection
      ? undefined
      : 'Select at least one column from each data block to add to workspace.';
  })();

  return (
    <DetachColumnsDialog
      open={open}
      onOpenChange={onOpenChange}
      isDetaching={isDetaching}
      title="Add topic results to workspace"
      description="Select optional source columns to include with the topic results being added to the workspace. Required output columns stay checked automatically."
      detachNodeOptions={detachNodeOptions}
      selectedDetachColumns={selectedDetachColumns}
      toggleDetachColumn={toggleDetachColumn}
      selectAllDetachColumns={selectAllDetachColumns}
      deselectAllDetachColumns={deselectAllDetachColumns}
      handleDetachConfirm={handleDetachConfirm}
      confirmDisabledReason={confirmDisabledReason}
    />
  );
}
