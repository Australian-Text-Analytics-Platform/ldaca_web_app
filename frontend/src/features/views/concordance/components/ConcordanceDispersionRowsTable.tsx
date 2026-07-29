import type { CSSProperties } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CONCORDANCE_DISPERSION_COLUMN } from '../../common/generatedColumns';
import {
  getDispersionBarWidthPercent,
  getDispersionHits,
  getDispersionTextLength,
  type ConcordanceDispersionRow,
} from '../concordanceDispersionDomain';
import { toCellText } from '../concordanceTableDomain';
import { ConcordanceDispersionCell } from './ConcordanceDispersionCell';

interface Props {
  rows: ConcordanceDispersionRow[];
  tableColumns: string[];
  searchWord: string;
  textColumn: string;
  longestTextLength: number;
  dispersionColumnStyle: CSSProperties | undefined;
  metadataColumnStyle: CSSProperties | undefined;
  proportionalDispersionBars: boolean;
  sourceColor?: string;
  sourceColorMap?: Record<string, string>;
  defaultPalette?: string[];
  getRowClassName: (row: ConcordanceDispersionRow, index: number) => string;
  getRowStyle?: (row: ConcordanceDispersionRow, index: number) => CSSProperties | undefined;
  onRowClick: (row: ConcordanceDispersionRow) => void;
}

/**
 * Renders the shared dispersion rows table used by combined and per-node
 * concordance result blocks.
 *
 * Used by: ConcordanceDispersionNodeBlock because both branches need identical
 * header, empty-state, hit-bar, metadata-cell, and column-width behavior while
 * keeping their row click and row colour rules separate.
 */
export function ConcordanceDispersionRowsTable({
  rows,
  tableColumns,
  searchWord,
  textColumn,
  longestTextLength,
  dispersionColumnStyle,
  metadataColumnStyle,
  proportionalDispersionBars,
  sourceColor,
  sourceColorMap,
  defaultPalette,
  getRowClassName,
  getRowStyle,
  onRowClick,
}: Props) {
  return (
    <Table className="w-full" disableContainer>
      <TableHeader className="bg-gray-50 sticky top-0 z-10">
        <TableRow>
          {tableColumns.map((columnKey) => (
            <TableHead
              key={columnKey}
              className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
              style={
                columnKey === CONCORDANCE_DISPERSION_COLUMN
                  ? dispersionColumnStyle
                  : metadataColumnStyle
              }
            >
              {columnKey}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell
              className="h-24 text-center text-muted-foreground"
              colSpan={tableColumns.length || 1}
            >
              No matching rows on this page for &quot;{searchWord}&quot;. Source rows without
              matches are omitted.
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row, index) => (
            <TableRow
              key={index}
              className={getRowClassName(row, index)}
              style={getRowStyle?.(row, index)}
              onClick={() => {
                onRowClick(row);
              }}
            >
              {tableColumns.map((columnKey, cellIndex) => (
                <TableCell
                  key={cellIndex}
                  style={
                    columnKey === CONCORDANCE_DISPERSION_COLUMN
                      ? dispersionColumnStyle
                      : metadataColumnStyle
                  }
                >
                  {columnKey === CONCORDANCE_DISPERSION_COLUMN ? (
                    <ConcordanceDispersionCell
                      hits={getDispersionHits(row)}
                      textLength={getDispersionTextLength(row, textColumn)}
                      barWidthPercent={
                        proportionalDispersionBars
                          ? getDispersionBarWidthPercent(row, textColumn, longestTextLength)
                          : 100
                      }
                      sourceColor={sourceColor}
                      sourceColorMap={sourceColorMap}
                      defaultPalette={defaultPalette}
                    />
                  ) : (
                    toCellText(row[columnKey])
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
