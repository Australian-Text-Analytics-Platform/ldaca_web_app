import type { Dispatch, SetStateAction } from 'react';

import {
  DetachColumnsDialog,
  type DetachDialogNodeOption,
} from '../../common/components/DetachColumnsDialog';

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

/** Rendered by: ConcordanceFeature to adapt the shared detach-column dialog for per-document dispersion outputs because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface. */
export function ConcordanceDispersionDetachDialog({
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
      title="Add aggregated concordance to workspace"
      description="The detached data block always includes the per-document extract, matched-text list, and L1/R1 contexts as list columns. Optionally include the document column and any source metadata columns. The document column is selected by default — uncheck to omit it."
      detachNodeOptions={detachNodeOptions}
      selectedDetachColumns={selectedDetachColumns}
      toggleDetachColumn={toggleDetachColumn}
      selectAllDetachColumns={selectAllDetachColumns}
      deselectAllDetachColumns={deselectAllDetachColumns}
      handleDetachConfirm={handleDetachConfirm}
    />
  );
}
