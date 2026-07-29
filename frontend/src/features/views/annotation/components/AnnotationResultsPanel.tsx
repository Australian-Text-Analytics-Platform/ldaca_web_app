import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useState } from 'react';
import { toast } from 'sonner';
import { sqlTable } from '@/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  applyReferenceComparisonEdit,
  type ConfusionCount,
  type IntercoderReliabilityMetric,
} from '@/features/views/common/columnComparisonModel';
import {
  ColumnComparisonHeader,
  ColumnComparisonSelector,
} from '@/features/views/common/components/ColumnComparison';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useFullColumnComparisons } from '@/features/views/common/hooks/useFullColumnComparisons';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { queryKeys } from '@/lib/queryKeys';
import { toBgColor } from '@/features/views/common/vizPalette';
import { annotationValuesDiffer } from '../annotationDifferenceQuery';
import { useAnnotationClassDescriptions } from '../hooks/useAnnotationClassDescriptions';
import { type AnnotationNodePageRow, useAnnotationNodePage } from '../hooks/useAnnotationNodePage';

const ANNOTATION_RESULT_PAGE_SIZE = 10;
// Radix `Select` rejects an empty-string item value, so the "clear" option uses
// a sentinel that onValueChange maps back to an unset/null annotation.
const NO_CLASS_VALUE = '__no_class__';
type AnnotationResultRow = AnnotationNodePageRow;

/** Coerce an unknown cell value to display text without object stringification. */
const cellText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

interface AnnotationResultsPanelProps {
  workspaceId: string | null;
  nodeId: string;
  sourceColumns: string[];
  sourceColor: string;
  rowCount: number;
  textColumn: string;
  annotationColumn: string;
  /** Class-description node supplying the dropdown options; null disables them. */
  classNodeId: string | null;
  classColumn: string | null;
  descriptionColumn: string | null;
  comparisonColumns: string[];
  onComparisonColumnsChange: (columns: string[]) => void;
  differenceFilterColumns: string[];
  onDifferenceFilterColumnsChange: (columns: string[]) => void;
  reliabilityMetric: IntercoderReliabilityMetric;
  onReliabilityMetricChange: (metric: IntercoderReliabilityMetric) => void;
  metadataColumns: string[];
  onMetadataColumnsChange: (columns: string[]) => void;
}

/**
 * Read-only text + editable-annotation result table shown below the Annotation
 * parameter panel once Resume is pressed, mirroring how other analysis
 * tabs surface a result table under their controls.
 *
 * Used by: AnnotationFeature after a run is triggered because reviewers want to
 * see the source text paired with the selected annotation column and assign a
 * class per row.
 *
 * Flow: fetch the current source-node page plus the class list, then render the
 * document and editable annotation columns followed by the selected read-only
 * comparison and metadata columns. The text column is plain; each annotation
 * cell is a dropdown of class names plus a leading "None" option that clears
 * the cell back to an unset value. Each
 * dropdown is seeded from the existing value. Picking a class updates the
 * dropdown and persists the cell as a canonical set_cell Data Block edit,
 * reverting on failure. Full-table comparisons share the Tab's selected target
 * columns and update their aggregate counts only after that edit succeeds.
 */
export function AnnotationResultsPanel({
  workspaceId,
  nodeId,
  sourceColumns,
  sourceColor,
  rowCount,
  textColumn,
  annotationColumn,
  classNodeId,
  classColumn,
  descriptionColumn,
  comparisonColumns,
  onComparisonColumnsChange,
  differenceFilterColumns,
  onDifferenceFilterColumnsChange,
  reliabilityMetric,
  onReliabilityMetricChange,
  metadataColumns,
  onMetadataColumnsChange,
}: AnnotationResultsPanelProps) {
  const { setCell } = useWorkspaceActions();
  const queryClient = useQueryClient();
  // Per-row class overrides keyed by source row position; falls back to the source value.
  const [selections, setSelections] = useState<Record<number, string | null>>({});
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());
  const nodePage = useAnnotationNodePage({
    workspaceId,
    nodeId,
    sourceSql: `SELECT * FROM ${sqlTable(nodeId)}`,
    sourceColumns,
    annotationColumn,
    differenceColumns: differenceFilterColumns,
    rowCount,
    pageSize: ANNOTATION_RESULT_PAGE_SIZE,
  });
  const {
    pagination,
    setPagination,
    query: resultsQuery,
    countQuery,
    rows,
    rowCount: effectiveRowCount,
    sourceRowIndexColumn,
  } = nodePage;
  const classDescriptions = useAnnotationClassDescriptions({
    workspaceId,
    nodeId: classNodeId,
    classColumn,
    descriptionColumn,
  });

  const classOptions = classDescriptions.rows
    .map((row) => cellText(row.class).trim())
    .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index);
  const sourceSql = `SELECT * FROM ${sqlTable(nodeId)}`;
  const dataColumns = resultsQuery.data?.columns.filter(
    (column) => column !== sourceRowIndexColumn,
  );
  const comparableColumnSet = new Set(
    resultsQuery.data?.schema
      .filter((column) => column.name !== sourceRowIndexColumn)
      .filter((column) => column.kind === 'string' || column.kind === 'categorical')
      .map((column) => column.name) ?? [],
  );
  const availableComparisonColumns =
    dataColumns?.filter(
      (column) =>
        column !== textColumn && column !== annotationColumn && comparableColumnSet.has(column),
    ) ?? [];
  const availableMetadataColumns =
    dataColumns?.filter((column) => column !== textColumn && column !== annotationColumn) ?? [];
  const activeComparisonColumns = comparisonColumns.filter((column) =>
    availableComparisonColumns.includes(column),
  );
  const activeMetadataColumns = metadataColumns.filter((column) =>
    availableMetadataColumns.includes(column),
  );
  const activeDifferenceFilterColumns = differenceFilterColumns.filter((column) =>
    activeComparisonColumns.includes(column),
  );
  const visibleSupplementalColumns = Array.from(
    new Set([...activeComparisonColumns, ...activeMetadataColumns]),
  );
  const visibleColumns = [textColumn, annotationColumn, ...visibleSupplementalColumns];
  const tableColumns: ColumnDef<AnnotationResultRow>[] = visibleColumns.map((column) => ({
    id: column,
    accessorFn: (row) => row[column],
  }));
  const table = useServerTable({
    data: rows,
    columns: tableColumns,
    rowCount: effectiveRowCount,
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
    onPaginationChange: setPagination,
  });
  const comparisonQueries = useFullColumnComparisons({
    workspaceId,
    nodeIds: [nodeId],
    sql: sourceSql,
    referenceColumn: annotationColumn,
    comparisonColumns: activeComparisonColumns,
  });
  const comparisonQueryByColumn = new Map(
    activeComparisonColumns.map((column, index) => [column, comparisonQueries[index]]),
  );

  return (
    <section
      aria-label="Annotation Results"
      className="mt-5 rounded-lg border bg-background/60 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Annotations</h3>
        {resultsQuery.data ? (
          <div className="flex flex-wrap items-center gap-2">
            <ColumnComparisonSelector
              availableColumns={availableComparisonColumns}
              selectedColumns={activeComparisonColumns}
              onSelectedColumnsChange={onComparisonColumnsChange}
              metric={reliabilityMetric}
              onMetricChange={onReliabilityMetricChange}
            />
            <MetadataColumnSelector
              availableColumns={availableMetadataColumns}
              selectedColumns={activeMetadataColumns}
              onSelectedColumnsChange={onMetadataColumnsChange}
            />
          </div>
        ) : null}
      </div>
      {resultsQuery.isLoading || countQuery.isLoading ? (
        <div className="rounded-md border border-border px-4 py-3 text-sm text-muted-foreground">
          Loading annotations...
        </div>
      ) : resultsQuery.isError || countQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Could not load annotations.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
          {activeDifferenceFilterColumns.length > 0
            ? 'No annotation differences.'
            : 'No rows to annotate.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-96 overflow-y-auto overflow-x-hidden">
            <Table className="w-full table-auto" disableContainer>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>{textColumn}</TableHead>
                  <TableHead className="w-px whitespace-nowrap">{annotationColumn}</TableHead>
                  {visibleSupplementalColumns.map((column) => (
                    <TableHead key={column} className="w-px whitespace-nowrap">
                      {activeComparisonColumns.includes(column) ? (
                        <ColumnComparisonHeader
                          metric={reliabilityMetric}
                          referenceColumn={annotationColumn}
                          comparisonColumn={column}
                          rows={comparisonQueryByColumn.get(column)?.data}
                          isLoading={comparisonQueryByColumn.get(column)?.isLoading ?? true}
                          isError={comparisonQueryByColumn.get(column)?.isError ?? false}
                          differenceFilterActive={activeDifferenceFilterColumns.includes(column)}
                          onDifferenceFilterChange={(active) => {
                            onDifferenceFilterColumnsChange(
                              active
                                ? Array.from(new Set([...activeDifferenceFilterColumns, column]))
                                : activeDifferenceFilterColumns.filter(
                                    (candidate) => candidate !== column,
                                  ),
                            );
                          }}
                        />
                      ) : (
                        column
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const rowPosition = Number(row[sourceRowIndexColumn]);
                  const seeded =
                    row[annotationColumn] == null ? null : cellText(row[annotationColumn]);
                  const hasSelection = Object.hasOwn(selections, rowPosition);
                  const committedValue: string | null =
                    (hasSelection ? selections[rowPosition] : seeded) ?? null;
                  const value = committedValue ?? '';
                  const annotationDiffers = activeComparisonColumns.some((column) =>
                    annotationValuesDiffer(committedValue, row[column]),
                  );
                  const differenceColor = toBgColor(sourceColor);
                  return (
                    <TableRow key={rowPosition} className="align-top hover:bg-transparent">
                      <TableCell className="break-words whitespace-pre-wrap">
                        {cellText(row[textColumn])}
                      </TableCell>
                      <TableCell
                        style={annotationDiffers ? { backgroundColor: differenceColor } : undefined}
                      >
                        <Select
                          // `value` is always a string ('' when unset); passing it
                          // directly keeps the Select controlled for its lifetime.
                          // Radix shows the placeholder for '' as well as undefined.
                          value={value}
                          onValueChange={(next) => {
                            const resolved = next === NO_CLASS_VALUE ? null : next;
                            const previousOverride: string | null = selections[rowPosition] ?? null;
                            const comparisonKeys = activeComparisonColumns.map((column) =>
                              queryKeys.annotationColumnComparison(
                                workspaceId ?? '',
                                [nodeId],
                                sourceSql,
                                annotationColumn,
                                column,
                              ),
                            );
                            const comparisonValues = activeComparisonColumns.map((column) =>
                              row[column] == null ? null : cellText(row[column]),
                            );
                            setSelections((current) => ({
                              ...current,
                              [rowPosition]: resolved,
                            }));
                            setSavingRows((current) => new Set(current).add(rowPosition));
                            void Promise.all(
                              comparisonKeys.map((queryKey) =>
                                queryClient.cancelQueries({ queryKey, exact: true }),
                              ),
                            )
                              .then(() => setCell(nodeId, annotationColumn, rowPosition, resolved))
                              .then(() => {
                                comparisonKeys.forEach((queryKey, comparisonIndex) => {
                                  const current =
                                    queryClient.getQueryData<ConfusionCount[]>(queryKey);
                                  if (current) {
                                    queryClient.setQueryData<ConfusionCount[]>(
                                      queryKey,
                                      applyReferenceComparisonEdit(current, {
                                        previousReference: committedValue,
                                        nextReference: resolved,
                                        comparison: comparisonValues[comparisonIndex] ?? null,
                                      }),
                                    );
                                  } else {
                                    void queryClient.refetchQueries({
                                      queryKey,
                                      exact: true,
                                      type: 'active',
                                    });
                                  }
                                });
                                return nodePage.refreshFilteredRows();
                              })
                              .catch((error: unknown) => {
                                setSelections((current) => {
                                  const nextSelections = { ...current };
                                  if (hasSelection) nextSelections[rowPosition] = previousOverride;
                                  else Reflect.deleteProperty(nextSelections, rowPosition);
                                  return nextSelections;
                                });
                                comparisonKeys.forEach((queryKey) => {
                                  if (!queryClient.getQueryData(queryKey)) {
                                    void queryClient.refetchQueries({
                                      queryKey,
                                      exact: true,
                                      type: 'active',
                                    });
                                  }
                                });
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : 'Could not save the annotation.',
                                );
                              })
                              .finally(() => {
                                setSavingRows((current) => {
                                  const nextSaving = new Set(current);
                                  nextSaving.delete(rowPosition);
                                  return nextSaving;
                                });
                              });
                          }}
                          disabled={savingRows.has(rowPosition)}
                        >
                          <SelectTrigger
                            aria-label={`Class for row ${String(rowPosition + 1)}`}
                            className="w-full text-sm"
                          >
                            <SelectValue placeholder="Select class" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CLASS_VALUE} className="text-muted-foreground">
                              None
                            </SelectItem>
                            {classOptions.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {visibleSupplementalColumns.map((column) => {
                        const comparisonDiffers =
                          activeComparisonColumns.includes(column) &&
                          annotationValuesDiffer(committedValue, row[column]);
                        return (
                          <TableCell
                            key={column}
                            className="w-px whitespace-pre-wrap"
                            style={
                              comparisonDiffers ? { backgroundColor: differenceColor } : undefined
                            }
                          >
                            {cellText(row[column]) || '—'}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <ServerPaginationFooter
            table={table}
            pageIndex={pagination.pageIndex}
            pageSize={pagination.pageSize}
            rowCount={effectiveRowCount}
            loading={resultsQuery.isFetching}
          />
        </div>
      )}
    </section>
  );
}
