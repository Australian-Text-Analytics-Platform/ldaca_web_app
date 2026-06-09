import type { Dispatch, SetStateAction } from 'react';

import {
  DetachColumnsDialog,
  type DetachDialogNodeOption,
} from '@/features/views/common/components/DetachColumnsDialog';

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

/**
 * Rendered by: TopicModelingResultsPanel to wrap the shared detach dialog with topic-modeling validation because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: derive display state, bind user actions, then render the analysis UI.
 */
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
  // The topic column and every source column are user-choosable here, all
  // selected by default. The shared dialog already blocks an all-empty
  // selection (a zero-column node), so no extra gating is needed — the user
  // owns the choice of which columns, including the topic number, to keep.
  return (
    <DetachColumnsDialog
      open={open}
      onOpenChange={onOpenChange}
      isDetaching={isDetaching}
      title="Detach Topic Results"
      description="Select the columns to include with the detached topic results. The topic column is selected by default; untick it if you don't need it."
      detachNodeOptions={detachNodeOptions}
      selectedDetachColumns={selectedDetachColumns}
      toggleDetachColumn={toggleDetachColumn}
      selectAllDetachColumns={selectAllDetachColumns}
      deselectAllDetachColumns={deselectAllDetachColumns}
      handleDetachConfirm={handleDetachConfirm}
    />
  );
}
