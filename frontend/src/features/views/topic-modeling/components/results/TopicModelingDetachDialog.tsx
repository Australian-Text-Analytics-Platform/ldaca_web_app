import type { Dispatch, SetStateAction } from 'react';

import {
  DetachColumnsDialog,
  type DetachDialogNodeOption,
} from '@/features/views/common/components/DetachColumnsDialog';

interface Props {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isDetaching: boolean;
  detachNodeOptions: DetachDialogNodeOption[];
  selectedDetachColumns: Record<string, string[]>;
  toggleDetachColumn: (nodeId: string, column: string, checked: boolean) => void;
  selectAllDetachColumns: () => void;
  deselectAllDetachColumns: () => void;
  handleDetachConfirm: () => Promise<void> | void;
}

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
  // The topic columns (TOPIC_top1, TOPIC_distribution) default-on and source
  // columns default-off; the shared dialog blocks an all-empty selection. The
  // distribution filter lives in the results tab, not here.
  return (
    <DetachColumnsDialog
      open={open}
      onOpenChange={onOpenChange}
      isDetaching={isDetaching}
      title="Detach Topic Results"
      description="Select the columns to include with the detached topic results. The topic columns are selected by default; untick any you don't need."
      detachNodeOptions={detachNodeOptions}
      selectedDetachColumns={selectedDetachColumns}
      toggleDetachColumn={toggleDetachColumn}
      selectAllDetachColumns={selectAllDetachColumns}
      deselectAllDetachColumns={deselectAllDetachColumns}
      handleDetachConfirm={handleDetachConfirm}
    />
  );
}
