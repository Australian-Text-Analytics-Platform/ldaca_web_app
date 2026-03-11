import type { Dispatch, SetStateAction } from 'react';

import {
  DetachColumnsDialog,
  type DetachDialogNodeOption,
} from '../../../components/DetachColumnsDialog';

type DetachNodeOption = DetachDialogNodeOption;

type Props = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  isDetaching: boolean;
  detachNodeOptions: DetachNodeOption[];
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
  return (
    <DetachColumnsDialog
      open={open}
      onOpenChange={onOpenChange}
      isDetaching={isDetaching}
      title="Detach Topic Results"
      description="Select optional source columns to include with the detached topic results. Required output columns stay checked automatically."
      detachNodeOptions={detachNodeOptions}
      selectedDetachColumns={selectedDetachColumns}
      toggleDetachColumn={toggleDetachColumn}
      selectAllDetachColumns={selectAllDetachColumns}
      deselectAllDetachColumns={deselectAllDetachColumns}
      handleDetachConfirm={handleDetachConfirm}
    />
  );
}
