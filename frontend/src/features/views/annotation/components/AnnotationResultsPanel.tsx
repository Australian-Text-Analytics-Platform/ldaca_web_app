import { useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight } from 'lucide-react';
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
import { isArrowDictionaryField, isArrowStringField } from '@/lib/arrow/arrowTable';
import { toBgColor } from '@/features/views/common/vizPalette';
import { annotationValuesDiffer } from '../annotationDifferenceQuery';
import { useAnnotationClassDescriptions } from '../hooks/useAnnotationClassDescriptions';
import { type AnnotationNodePageRow, useAnnotationNodePage } from '../hooks/useAnnotationNodePage';
import { AnnotationCorrectionColumnControl } from './AnnotationCorrectionColumnControl';

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
  reliabilityMetric: IntercoderReliabilityMetric;
  onReliabilityMetricChange: (metric: IntercoderReliabilityMetric) => void;
  metadataColumns: string[];
  onMetadataColumnsChange: (columns: string[]) => void;
  correction: {
    column: string | null;
    onColumnChange: (column: string | null) => void;
    onCreate: () => void;
    disabled?: boolean;
  };
}

/**
 * Read-only text + editable-annotation result table shown below the Annotation
 * parameter panel once Start is pressed, mirroring how other analysis
 * tabs surface a result table under their controls.
 *
 * Used by: AnnotationFeature after a run is triggered because reviewers want to
 * see the source text paired with the selected annotation column and assign a
 * class per row.
 *
 * Flow: fetch the current source-node page plus the class list, then render the
 * document and editable annotation columns followed by the selected read-only
 * comparison and metadata columns. Comparisons start masked; revealing one
 * enables its full-table reliability query, tint, and server-side difference
 * filter for this mount. The text column is plain; each annotation
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
  reliabilityMetric,
  onReliabilityMetricChange,
  metadataColumns,
  onMetadataColumnsChange,
  correction,
}: AnnotationResultsPanelProps) {
  const correctionColumn = correction.column;
  const { setCell } = useWorkspaceActions();
  const queryClient = useQueryClient();
  // Per-row class overrides keyed by source row position; falls back to the source value.
  const [selections, setSelections] = useState<Record<number, string | null>>({});
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());
  const [correctionSelections, setCorrectionSelections] = useState<Record<string, string | null>>(
    {},
  );
  const [savingCorrectionRows, setSavingCorrectionRows] = useState<Set<string>>(new Set());
  const [revealedComparisonColumns, setRevealedComparisonColumns] = useState<Set<string>>(
    new Set(),
  );
  const [differenceColumn, setDifferenceColumn] = useState<string | null>(null);
  const nodePage = useAnnotationNodePage({
    workspaceId,
    nodeId,
    sourceSql: `SELECT * FROM ${sqlTable(nodeId)}`,
    sourceColumns,
    annotationColumn,
    differenceColumn,
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
      .filter((column) => isArrowStringField(column.field) || isArrowDictionaryField(column.field))
      .map((column) => column.name) ?? [],
  );
  const stringColumnSet = new Set(
    resultsQuery.data?.schema
      .filter((column) => column.name !== sourceRowIndexColumn && isArrowStringField(column.field))
      .map((column) => column.name) ?? [],
  );
  const availableCorrectionColumns = resultsQuery.data
    ? (dataColumns?.filter(
        (column) =>
          column !== textColumn && column !== annotationColumn && stringColumnSet.has(column),
      ) ?? [])
    : null;
  const availableComparisonColumns =
    dataColumns?.filter(
      (column) =>
        column !== textColumn &&
        column !== annotationColumn &&
        column !== correctionColumn &&
        comparableColumnSet.has(column),
    ) ?? [];
  const availableMetadataColumns =
    dataColumns?.filter(
      (column) =>
        column !== textColumn && column !== annotationColumn && column !== correctionColumn,
    ) ?? [];
  const activeComparisonColumns = comparisonColumns.filter((column) =>
    availableComparisonColumns.includes(column),
  );
  const activeMetadataColumns = metadataColumns.filter((column) =>
    availableMetadataColumns.includes(column),
  );
  const revealedActiveComparisonColumns = activeComparisonColumns.filter((column) =>
    revealedComparisonColumns.has(column),
  );
  const activeDifferenceColumn =
    differenceColumn && revealedActiveComparisonColumns.includes(differenceColumn)
      ? differenceColumn
      : null;
  const supplementalColumns = [...activeComparisonColumns, ...activeMetadataColumns];
  const tableColumns: ColumnDef<AnnotationResultRow>[] = [
    { id: textColumn, accessorFn: (row) => row[textColumn] },
    { id: annotationColumn, accessorFn: (row) => row[annotationColumn] },
    ...(correctionColumn
      ? [
          { id: 'correction_arrow', accessorFn: () => null },
          { id: correctionColumn, accessorFn: (row: AnnotationResultRow) => row[correctionColumn] },
        ]
      : []),
    ...supplementalColumns.map((column) => ({
      id: column,
      accessorFn: (row: AnnotationResultRow) => row[column],
    })),
  ];
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
    comparisonColumns: revealedActiveComparisonColumns,
  });
  const comparisonQueryByColumn = new Map(
    revealedActiveComparisonColumns.map((column, index) => [column, comparisonQueries[index]]),
  );

  return (
    <section
      aria-label="Annotation Results"
      className="mt-5 rounded-lg border bg-background/60 p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 data-guidance="annotation-manual-results" className="text-base font-semibold">
          Annotations
        </h3>
        {resultsQuery.data ? (
          <div className="flex flex-wrap items-center gap-2">
            <ColumnComparisonSelector
              availableColumns={availableComparisonColumns}
              selectedColumns={activeComparisonColumns}
              onSelectedColumnsChange={(columns) => {
                const selected = columns.filter((column) => column !== correctionColumn);
                setRevealedComparisonColumns(
                  (current) => new Set([...current].filter((column) => selected.includes(column))),
                );
                if (differenceColumn && !selected.includes(differenceColumn)) {
                  setDifferenceColumn(null);
                }
                onComparisonColumnsChange(selected);
              }}
              metric={reliabilityMetric}
              onMetricChange={onReliabilityMetricChange}
              disabledColumns={activeMetadataColumns}
            />
            <AnnotationCorrectionColumnControl
              value={correctionColumn}
              availableColumns={availableCorrectionColumns}
              onValueChange={(column) => {
                if (column) {
                  onComparisonColumnsChange(
                    activeComparisonColumns.filter((selected) => selected !== column),
                  );
                  onMetadataColumnsChange(
                    activeMetadataColumns.filter((selected) => selected !== column),
                  );
                  setRevealedComparisonColumns((current) => {
                    const next = new Set(current);
                    next.delete(column);
                    return next;
                  });
                  if (differenceColumn === column) setDifferenceColumn(null);
                }
                correction.onColumnChange(column);
              }}
              onCreate={correction.onCreate}
              disabled={correction.disabled}
            />
            <MetadataColumnSelector
              availableColumns={availableMetadataColumns}
              selectedColumns={activeMetadataColumns}
              onSelectedColumnsChange={onMetadataColumnsChange}
              disabledColumns={activeComparisonColumns}
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
          {activeDifferenceColumn ? 'No annotation differences.' : 'No rows to annotate.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-96 overflow-auto">
            <Table className="w-full table-auto" disableContainer>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>{textColumn}</TableHead>
                  <TableHead className="w-px whitespace-nowrap">{annotationColumn}</TableHead>
                  {correctionColumn ? (
                    <>
                      <TableHead className="w-8 px-1 text-center" aria-label="changes to">
                        <ArrowRight aria-hidden="true" className="mx-auto size-4" />
                      </TableHead>
                      <TableHead className="w-px whitespace-nowrap">
                        <>Correction: {correctionColumn}</>
                      </TableHead>
                    </>
                  ) : null}
                  {supplementalColumns.map((column) => (
                    <TableHead key={column} className="w-px whitespace-nowrap">
                      {activeComparisonColumns.includes(column) ? (
                        <ColumnComparisonHeader
                          metric={reliabilityMetric}
                          referenceColumn={annotationColumn}
                          comparisonColumn={column}
                          rows={comparisonQueryByColumn.get(column)?.data}
                          isLoading={comparisonQueryByColumn.get(column)?.isLoading ?? true}
                          isError={comparisonQueryByColumn.get(column)?.isError ?? false}
                          revealed={revealedComparisonColumns.has(column)}
                          onRevealedChange={(revealed) => {
                            setRevealedComparisonColumns((current) => {
                              const next = new Set(current);
                              if (revealed) next.add(column);
                              else next.delete(column);
                              return next;
                            });
                            if (!revealed && differenceColumn === column) {
                              setDifferenceColumn(null);
                            }
                          }}
                          differenceFilterActive={activeDifferenceColumn === column}
                          onDifferenceFilterChange={(active) => {
                            setDifferenceColumn(active ? column : null);
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
                  const correctionKey = correctionColumn
                    ? `${correctionColumn}:${String(rowPosition)}`
                    : '';
                  const seededCorrection = correctionColumn
                    ? row[correctionColumn] == null
                      ? null
                      : cellText(row[correctionColumn])
                    : null;
                  const hasCorrectionSelection = Object.hasOwn(correctionSelections, correctionKey);
                  const correctionValue = hasCorrectionSelection
                    ? (correctionSelections[correctionKey] ?? null)
                    : seededCorrection;
                  const comparisonValue = (column: string): unknown =>
                    column === correctionColumn ? correctionValue : row[column];
                  const annotationDiffers = revealedActiveComparisonColumns.some((column) =>
                    annotationValuesDiffer(committedValue, comparisonValue(column)),
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
                      {correctionColumn ? (
                        <>
                          <TableCell className="w-8 px-1 text-center">
                            <ArrowRight
                              role="img"
                              aria-label="corrected to"
                              className="mx-auto size-4 text-muted-foreground"
                            />
                          </TableCell>
                          <TableCell className="w-px">
                            <Select
                              value={correctionValue ?? NO_CLASS_VALUE}
                              disabled={savingCorrectionRows.has(correctionKey)}
                              onValueChange={(next) => {
                                const resolved = next === NO_CLASS_VALUE ? null : next;
                                const previous = correctionValue;
                                setCorrectionSelections((current) => ({
                                  ...current,
                                  [correctionKey]: resolved,
                                }));
                                setSavingCorrectionRows((current) =>
                                  new Set(current).add(correctionKey),
                                );
                                void setCell(nodeId, correctionColumn, rowPosition, resolved)
                                  .catch((error: unknown) => {
                                    setCorrectionSelections((current) => {
                                      const nextSelections = { ...current };
                                      if (hasCorrectionSelection) {
                                        nextSelections[correctionKey] = previous;
                                      } else {
                                        Reflect.deleteProperty(nextSelections, correctionKey);
                                      }
                                      return nextSelections;
                                    });
                                    toast.error(
                                      error instanceof Error
                                        ? error.message
                                        : 'Could not save the annotation correction.',
                                    );
                                  })
                                  .finally(() => {
                                    setSavingCorrectionRows((current) => {
                                      const nextSaving = new Set(current);
                                      nextSaving.delete(correctionKey);
                                      return nextSaving;
                                    });
                                  });
                              }}
                            >
                              <SelectTrigger
                                aria-label={`Correction for row ${String(rowPosition + 1)}`}
                                className="w-full text-sm"
                              >
                                <SelectValue placeholder="None" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem
                                  value={NO_CLASS_VALUE}
                                  className="text-muted-foreground"
                                >
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
                        </>
                      ) : null}
                      {supplementalColumns.map((column) => {
                        const comparisonRevealed =
                          activeComparisonColumns.includes(column) &&
                          revealedComparisonColumns.has(column);
                        const comparisonDiffers =
                          comparisonRevealed &&
                          annotationValuesDiffer(committedValue, comparisonValue(column));
                        return (
                          <TableCell
                            key={column}
                            className="w-px whitespace-pre-wrap"
                            style={
                              comparisonDiffers ? { backgroundColor: differenceColor } : undefined
                            }
                          >
                            {activeComparisonColumns.includes(column) && !comparisonRevealed ? (
                              <span aria-label="Comparison value hidden">•••</span>
                            ) : (
                              cellText(comparisonValue(column)) || '—'
                            )}
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
