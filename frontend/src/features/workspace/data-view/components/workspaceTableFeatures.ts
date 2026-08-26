import {
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  metaHelper,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  type Column,
  type ColumnDef,
} from '@tanstack/react-table';
import type { DataRow } from '../types';

interface WorkspaceColumnMeta {
  headerClassName?: string;
  headerMinWidth?: number;
  headerMaxWidth?: number;
  cellClassName?: string;
  cellMinWidth?: number;
  cellMaxWidth?: number;
}

export const workspaceTableFeatures = tableFeatures({
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  columnMeta: metaHelper<WorkspaceColumnMeta>(),
});

export type WorkspaceTableColumn = Column<typeof workspaceTableFeatures, DataRow>;
export type WorkspaceTableColumnDef = ColumnDef<typeof workspaceTableFeatures, DataRow>;
