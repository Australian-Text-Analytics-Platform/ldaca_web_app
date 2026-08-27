import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useRef, useState } from 'react';
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
import { AnnotationColumnFilterMenu } from '@/features/views/common/components/AnnotationColumnFilterMenu';
import {
  ColumnComparisonHeader,
  ColumnComparisonSelector,
} from '@/features/views/common/components/ColumnComparison';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useFullColumnComparisons } from '@/features/views/common/hooks/useFullColumnComparisons';
import { type ServerColumnDef, useServerTable } from '@/features/views/common/hooks/useServerTable';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { queryKeys } from '@/lib/queryKeys';
import { isArrowDictionaryField, isArrowStringField } from '@/lib/arrow/arrowTable';
import { toBgColor } from '@/features/views/common/vizPalette';
import {
  annotationValuesDiffer,
  isInvalidAnnotationLabel,
  normalizeAnnotationLabel,
  normalizeAnnotationClassOptions,
} from '../annotationLabelModel';
import { useAnnotationClassDescriptions } from '../hooks/useAnnotationClassDescriptions';
import { type AnnotationNodePageRow, useAnnotationNodePage } from '../hooks/useAnnotationNodePage';
import { useAnnotationRowFilter } from '../hooks/useAnnotationRowFilter';
import { AnnotationCorrectionColumnControl } from './AnnotationCorrectionColumnControl';
import { AnnotationTableFrame } from './AnnotationTableFrame';
import { CurrentAnnotationValueItem } from './CurrentAnnotationValueItem';

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
  /** Shared per-tab result-table height; null keeps the default. */
  tableHeight: number | null;
  onTableHeightChange: (height: number | null) => void;
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
 * comparison and metadata columns. Comparisons start masked: their full-table
 * reliability and row filter are always available, while per-row values and
 * difference tint wait for reveal. One mount-local row filter (difference
 * and/or existence) may sit on the annotation column or one comparison column
 * at a time; empty, blank, and non-Codebook cells never count as differences
 * or as values. The text column is plain; each annotation
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
  tableHeight,
  onTableHeightChange,
  correction,
}: AnnotationResultsPanelProps) {
  const tableViewportRef = useRef<HTMLDivElement>(null);
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
  const classDescriptions = useAnnotationClassDescriptions({
    workspaceId,
    nodeId: classNodeId,
    classColumn,
    descriptionColumn,
  });
  const classOptions = normalizeAnnotationClassOptions(
    classDescriptions.rows.map((row) => cellText(row.class)),
  );
  // Columns the annotation-column difference filter compares against; excludes role conflicts.
  const queryComparisonColumns = comparisonColumns.filter(
    (column) =>
      sourceColumns.includes(column) &&
      column !== textColumn &&
      column !== annotationColumn &&
      column !== correctionColumn,
  );
  const {
    filter: activeFilter,
    valueFor: filterValueFor,
    setFor: setColumnFilter,
  } = useAnnotationRowFilter(annotationColumn, queryComparisonColumns);
  const nodePage = useAnnotationNodePage({
    workspaceId,
    nodeId,
    sourceSql: `SELECT * FROM ${sqlTable(nodeId)}`,
    sourceColumns,
    annotationColumn,
    comparisonColumns: queryComparisonColumns,
    classOptions,
    filter: activeFilter,
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
  const supplementalColumns = [...activeComparisonColumns, ...activeMetadataColumns];
  const tableColumns: ServerColumnDef<AnnotationResultRow>[] = [
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
    onPaginationChange: (next) => {
      if (next.pageIndex !== pagination.pageIndex || next.pageSize !== pagination.pageSize) {
        if (tableViewportRef.current) tableViewportRef.current.scrollTop = 0;
      }
      setPagination(next);
    },
  });
  const comparisonQueries = useFullColumnComparisons({
    workspaceId,
    nodeIds: [nodeId],
    sql: sourceSql,
    referenceColumn: annotationColumn,
    comparisonColumns: activeComparisonColumns,
    classOptions,
  });
  const comparisonQueryByColumn = new Map(
    activeComparisonColumns.map((column, index) => [column, comparisonQueries[index]]),
  );

  return (
    <section aria-label="Annotation Results" className="mt-5 rounded-lg border bg-editor/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 data-guidance="annotation-manual-results" className="text-body font-semibold">
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
        <div className="rounded-md border border-surface-border px-4 py-3 text-body text-description">
          Loading annotations...
        </div>
      ) : resultsQuery.isError || countQuery.isError ? (
        <div className="rounded-md border border-error/30 bg-error/5 px-4 py-3 text-body text-error">
          Could not load annotations.
        </div>
      ) : (
        <AnnotationTableFrame
          height={tableHeight}
          onHeightChange={onTableHeightChange}
          viewportRef={tableViewportRef}
          belowTable={
            <ServerPaginationFooter
              table={table}
              pageIndex={pagination.pageIndex}
              pageSize={pagination.pageSize}
              rowCount={effectiveRowCount}
              loading={resultsQuery.isFetching}
            />
          }
        >
          <Table className="w-full table-auto" disableContainer>
            <TableHeader className="sticky top-0 z-10 bg-surface">
              <TableRow className="[&>th]:align-bottom">
                <TableHead>{textColumn}</TableHead>
                <TableHead className="w-px whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span>{annotationColumn}</span>
                    <AnnotationColumnFilterMenu
                      column={annotationColumn}
                      value={filterValueFor(annotationColumn)}
                      onChange={(value) => {
                        setColumnFilter(annotationColumn, value);
                      }}
                      differsLabel="Differs from any comparison column"
                      differsDisabled={activeComparisonColumns.length === 0}
                      differsDisabledReason="Select a Compare To column first"
                    />
                  </span>
                </TableHead>
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
                        }}
                        filter={filterValueFor(column)}
                        onFilterChange={(value) => {
                          setColumnFilter(column, value);
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
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    className="h-24 text-center text-description"
                    colSpan={tableColumns.length}
                  >
                    {activeFilter ? 'No rows match the filter.' : 'No rows to annotate.'}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row, index) => {
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
                  annotationValuesDiffer(committedValue, comparisonValue(column), classOptions),
                );
                const differenceColor = toBgColor(sourceColor);
                return (
                  <TableRow
                    key={rowPosition}
                    className={`align-top ${index % 2 === 0 ? 'bg-surface hover:bg-surface' : 'bg-panel hover:bg-panel'}`}
                  >
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
                              classOptions,
                            ),
                          );
                          const comparisonValues = activeComparisonColumns.map((column) =>
                            normalizeAnnotationLabel(row[column], classOptions),
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
                                      previousReference: normalizeAnnotationLabel(
                                        committedValue,
                                        classOptions,
                                      ),
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
                          className={`w-full text-body ${
                            isInvalidAnnotationLabel(committedValue, classOptions)
                              ? 'italic text-description'
                              : ''
                          }`}
                        >
                          <SelectValue placeholder="Select class" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_CLASS_VALUE} className="text-description">
                            None
                          </SelectItem>
                          <CurrentAnnotationValueItem
                            value={committedValue}
                            classOptions={classOptions}
                          />
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
                            className="mx-auto size-4 text-description"
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
                              className={`w-full text-body ${
                                isInvalidAnnotationLabel(correctionValue, classOptions)
                                  ? 'italic text-description'
                                  : ''
                              }`}
                            >
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_CLASS_VALUE} className="text-description">
                                None
                              </SelectItem>
                              <CurrentAnnotationValueItem
                                value={correctionValue}
                                classOptions={classOptions}
                              />
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
                      const isComparison = activeComparisonColumns.includes(column);
                      const comparisonRevealed =
                        isComparison && revealedComparisonColumns.has(column);
                      const comparisonDiffers =
                        comparisonRevealed &&
                        annotationValuesDiffer(
                          committedValue,
                          comparisonValue(column),
                          classOptions,
                        );
                      const invalid =
                        comparisonRevealed &&
                        isInvalidAnnotationLabel(comparisonValue(column), classOptions);
                      return (
                        <TableCell
                          key={column}
                          className={isComparison ? 'w-px whitespace-nowrap' : 'w-px'}
                          style={
                            comparisonDiffers ? { backgroundColor: differenceColor } : undefined
                          }
                        >
                          {isComparison && !comparisonRevealed ? (
                            <span aria-label="Comparison value hidden">•••</span>
                          ) : isComparison ? (
                            <span
                              className={invalid ? 'italic text-description' : undefined}
                              title={invalid ? 'Not a Codebook class; treated as empty' : undefined}
                            >
                              {cellText(comparisonValue(column)) || '—'}
                            </span>
                          ) : (
                            <div className="w-max max-w-64 break-words whitespace-pre-wrap">
                              {cellText(comparisonValue(column)) || '—'}
                            </div>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </AnnotationTableFrame>
      )}
    </section>
  );
}
