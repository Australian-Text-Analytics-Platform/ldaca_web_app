import type { CSSProperties } from 'react';
import type { ConcordanceNodeResult } from '@/api';
import { CONCORDANCE_DISPERSION_COLUMN } from '../../common/generatedColumns';
import {
  buildDispersionRows,
  getDispersionTextLength,
  type ConcordanceDispersionRow,
} from '../concordanceDispersionDomain';

const DISPERSION_COLUMN_WIDTH_RATIO = 0.85;
const METADATA_COLUMN_MIN_WIDTH_PX = 200;

/**
 * When metadata columns are visible, lock the dispersion bar column to 85% of
 * the viewport so hit bars remain readable while metadata scrolls horizontally.
 * Used by: ConcordanceDispersionRowsTable through buildConcordanceDispersionTableModel.
 */
export const getDispersionColumnStyle = (
  isMetadataVisible: boolean,
  visibleWidth: number,
): CSSProperties | undefined => {
  if (!isMetadataVisible || visibleWidth <= 0) {
    return undefined;
  }

  const columnWidth = `${String(Math.floor(visibleWidth * DISPERSION_COLUMN_WIDTH_RATIO))}px`;
  return {
    width: columnWidth,
    minWidth: columnWidth,
    maxWidth: columnWidth,
  };
};

/**
 * Force a sensible minimum width on each visible metadata column so the table
 * extends beyond the viewport when needed, enabling horizontal scroll.
 * Used by: ConcordanceDispersionRowsTable through buildConcordanceDispersionTableModel.
 */
const getMetadataColumnStyle = (isMetadataVisible: boolean): CSSProperties | undefined =>
  isMetadataVisible ? { minWidth: `${String(METADATA_COLUMN_MIN_WIDTH_PX)}px` } : undefined;

interface Params {
  nodeData: ConcordanceNodeResult;
  textColumn: string;
  showMetadata: boolean;
  selectedMetadataColumns: string[];
  resultsViewportWidth: number;
  proportionalDispersionBars: boolean;
}

export interface ConcordanceDispersionTableModel {
  rows: ConcordanceDispersionRow[];
  longestTextLength: number;
  tableColumns: string[];
  dispersionColumnStyle: CSSProperties | undefined;
  metadataColumnStyle: CSSProperties | undefined;
}

/**
 * Builds the normalized table model shared by combined and per-node
 * concordance dispersion blocks.
 *
 * Used by: ConcordanceDispersionNodeBlock before rendering either branch so
 * row grouping, metadata-column filtering, duplicate-column removal, and
 * fixed dispersion-column sizing stay identical.
 */
export function buildConcordanceDispersionTableModel({
  nodeData,
  textColumn,
  showMetadata,
  selectedMetadataColumns,
  resultsViewportWidth,
  proportionalDispersionBars,
}: Params): ConcordanceDispersionTableModel {
  const rows = buildDispersionRows(nodeData.data);
  const longestTextLength = proportionalDispersionBars
    ? rows.reduce((max, row) => Math.max(max, getDispersionTextLength(row, textColumn)), 0)
    : 0;
  const metadataColumns = nodeData.metadata.metadata_columns;
  const visibleMetadataColumns = selectedMetadataColumns.filter((columnName) =>
    metadataColumns.includes(columnName),
  );
  const rawDisplayColumns = showMetadata
    ? [
        CONCORDANCE_DISPERSION_COLUMN,
        ...visibleMetadataColumns.filter((columnName) => nodeData.columns.includes(columnName)),
      ]
    : [CONCORDANCE_DISPERSION_COLUMN];
  const displayColumns = Array.from(new Set(rawDisplayColumns));

  return {
    rows,
    longestTextLength,
    tableColumns: displayColumns,
    dispersionColumnStyle: getDispersionColumnStyle(showMetadata, resultsViewportWidth),
    metadataColumnStyle: getMetadataColumnStyle(showMetadata),
  };
}
