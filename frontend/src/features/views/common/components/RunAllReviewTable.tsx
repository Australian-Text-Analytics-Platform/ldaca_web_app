import type { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
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
import { TooltipProvider } from '@/components/ui/tooltip';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import {
  ColumnComparisonHeader,
  ColumnComparisonSelector,
  DifferenceFilterButton,
} from '@/features/views/common/components/ColumnComparison';
import {
  applyComparisonValueEdit,
  type ConfusionCount,
  type IntercoderReliabilityMetric,
} from '@/features/views/common/columnComparisonModel';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useFullColumnComparisons } from '@/features/views/common/hooks/useFullColumnComparisons';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import {
  type AnnotationDifferenceFilter,
  annotationValuesDiffer,
} from '@/features/views/annotation/annotationDifferenceQuery';
import { useAnnotationNodePage } from '@/features/views/annotation/hooks/useAnnotationNodePage';
import { toBgColor } from '@/features/views/common/vizPalette';
import { AnnotationCorrectionColumnControl } from '@/features/views/annotation/components/AnnotationCorrectionColumnControl';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { queryKeys } from '@/lib/queryKeys';
import { isArrowDictionaryField, isArrowStringField } from '@/lib/arrow/arrowTable';

const DEFAULT_PAGE_SIZE = 10;
const NO_CORRECTION_VALUE = '__no_correction__';

const displayCell = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

interface RunAllReviewTableProps {
  workspaceId: string;
  nodeId: string;
  sql: string;
  sourceColumns: string[];
  sourceColor: string;
  title: string;
  guidanceTarget?: string;
  requiredColumns: string[];
  comparisonColumn: string;
  comparisonColumns: string[];
  onComparisonColumnsChange: (columns: string[]) => void;
  differenceFilter: AnnotationDifferenceFilter | null;
  onDifferenceFilterChange: (filter: AnnotationDifferenceFilter | null) => void;
  reliabilityMetric: IntercoderReliabilityMetric;
  onReliabilityMetricChange: (metric: IntercoderReliabilityMetric) => void;
  metadataColumns: string[];
  onMetadataColumnsChange: (columns: string[]) => void;
  correction: {
    column: string | null;
    classOptions: string[];
    onColumnChange: (column: string | null) => void;
    onCreate: () => void;
    onUseAsExample: () => void;
    disabled?: boolean;
  };
  rowCount: number;
}

/** Renders a current Data Block projection for the durable Review phase. */
export function RunAllReviewTable({
  workspaceId,
  nodeId,
  sql,
  sourceColumns,
  sourceColor,
  title,
  guidanceTarget,
  requiredColumns,
  comparisonColumn,
  comparisonColumns,
  onComparisonColumnsChange,
  differenceFilter,
  onDifferenceFilterChange,
  reliabilityMetric,
  onReliabilityMetricChange,
  metadataColumns,
  onMetadataColumnsChange,
  correction,
  rowCount,
}: RunAllReviewTableProps) {
  const correctionColumn = correction.column;
  const { setCell } = useWorkspaceActions();
  const queryClient = useQueryClient();
  const [correctionSelections, setCorrectionSelections] = useState<Record<string, string | null>>(
    {},
  );
  const [savingCorrectionRows, setSavingCorrectionRows] = useState<Set<string>>(new Set());
  const page = useAnnotationNodePage({
    workspaceId,
    nodeId,
    sourceSql: sql,
    sourceColumns,
    annotationColumn: comparisonColumn,
    comparisonColumns,
    differenceFilter,
    rowCount,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const { pagination, setPagination, query, countQuery, sourceRowIndexColumn } = page;
  const data = query.data;
  const dataColumns = data?.columns.filter((column) => column !== sourceRowIndexColumn);
  const requiredColumnSet = new Set(requiredColumns);
  const availableMetadataColumns =
    dataColumns?.filter(
      (column) => !requiredColumnSet.has(column) && column !== correctionColumn,
    ) ?? [];
  const comparableColumnSet = new Set(
    data?.schema
      .filter((column) => column.name !== sourceRowIndexColumn)
      .filter((column) => isArrowStringField(column.field) || isArrowDictionaryField(column.field))
      .map((column) => column.name) ?? [],
  );
  const stringColumnSet = new Set(
    data?.schema
      .filter((column) => column.name !== sourceRowIndexColumn && isArrowStringField(column.field))
      .map((column) => column.name) ?? [],
  );
  const availableCorrectionColumns = data
    ? (dataColumns?.filter(
        (column) =>
          column !== requiredColumns[0] &&
          column !== comparisonColumn &&
          stringColumnSet.has(column),
      ) ?? [])
    : null;
  const comparisonExcludedColumns = new Set([requiredColumns[0], comparisonColumn]);
  const availableComparisonColumns =
    dataColumns?.filter(
      (column) => !comparisonExcludedColumns.has(column) && comparableColumnSet.has(column),
    ) ?? [];
  const activeComparisonColumns = comparisonColumns.filter((column) =>
    availableComparisonColumns.includes(column),
  );
  const activeDifferenceFilter =
    differenceFilter?.kind === 'any'
      ? activeComparisonColumns.length > 0
        ? differenceFilter
        : null
      : differenceFilter?.kind === 'column' &&
          activeComparisonColumns.includes(differenceFilter.column)
        ? differenceFilter
        : null;
  const activeMetadataColumns = metadataColumns.filter(
    (column) => availableMetadataColumns.includes(column) && column !== correctionColumn,
  );
  const displayedComparisonColumns = activeComparisonColumns.filter(
    (column) => column !== correctionColumn,
  );
  const comparisonQueries = useFullColumnComparisons({
    workspaceId,
    nodeIds: [nodeId],
    sql,
    referenceColumn: comparisonColumn,
    comparisonColumns: activeComparisonColumns,
  });
  const comparisonQueryByColumn = new Map(
    activeComparisonColumns.map((column, index) => [column, comparisonQueries[index]]),
  );
  const visibleRequiredColumns = requiredColumns.filter(
    (column) => dataColumns?.includes(column) && column !== correctionColumn,
  );
  const supplementalColumns = Array.from(
    new Set([...displayedComparisonColumns, ...activeMetadataColumns]),
  );
  const tableColumns: ColumnDef<Record<string, unknown>>[] = [
    ...visibleRequiredColumns.map((column) => ({
      id: column,
      accessorFn: (row: Record<string, unknown>) => row[column],
    })),
    ...(correctionColumn
      ? [
          { id: 'correction_arrow', accessorFn: () => null },
          {
            id: correctionColumn,
            accessorFn: (row: Record<string, unknown>) => row[correctionColumn],
          },
        ]
      : []),
    ...supplementalColumns.map((column) => ({
      id: column,
      accessorFn: (row: Record<string, unknown>) => row[column],
    })),
  ];
  const table = useServerTable({
    data: page.rows,
    columns: tableColumns,
    rowCount: page.rowCount,
    pageIndex: pagination.pageIndex,
    pageSize: pagination.pageSize,
    onPaginationChange: setPagination,
  });

  return (
    <section aria-label={`${title} Review`} className="rounded-lg border bg-background/60 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 data-guidance={guidanceTarget} className="text-base font-semibold">
          {title} Review
        </h3>
        {data ? (
          <div className="flex flex-wrap items-center gap-2">
            <ColumnComparisonSelector
              availableColumns={availableComparisonColumns}
              selectedColumns={activeComparisonColumns}
              onSelectedColumnsChange={onComparisonColumnsChange}
              metric={reliabilityMetric}
              onMetricChange={onReliabilityMetricChange}
            />
            <AnnotationCorrectionColumnControl
              value={correctionColumn}
              availableColumns={availableCorrectionColumns}
              onValueChange={correction.onColumnChange}
              onCreate={correction.onCreate}
              onUseAsExample={correction.onUseAsExample}
              disabled={correction.disabled}
            />
            <MetadataColumnSelector
              availableColumns={availableMetadataColumns}
              selectedColumns={activeMetadataColumns}
              onSelectedColumnsChange={onMetadataColumnsChange}
            />
          </div>
        ) : null}
      </div>
      {query.isError || countQuery.isError ? (
        <p className="text-sm text-destructive">Could not load Review.</p>
      ) : query.isLoading || countQuery.isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading Review...</p>
      ) : (
        <AnalysisTableFrame
          maxHeightClass="max-h-96"
          belowTable={
            <ServerPaginationFooter
              table={table}
              pageIndex={pagination.pageIndex}
              pageSize={pagination.pageSize}
              rowCount={page.rowCount}
              loading={query.isFetching || countQuery.isFetching}
            />
          }
        >
          <Table disableContainer>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                {visibleRequiredColumns.map((column) => (
                  <TableHead key={column}>
                    {column === comparisonColumn ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{column}</span>
                        <TooltipProvider delayDuration={120} skipDelayDuration={0}>
                          <DifferenceFilterButton
                            active={activeDifferenceFilter?.kind === 'any'}
                            ariaLabel={`Filter any difference for ${comparisonColumn}`}
                            tooltip="Filter any difference"
                            onActiveChange={(active) => {
                              onDifferenceFilterChange(active ? { kind: 'any' } : null);
                            }}
                          />
                        </TooltipProvider>
                      </span>
                    ) : activeComparisonColumns.includes(column) ? (
                      <ColumnComparisonHeader
                        metric={reliabilityMetric}
                        referenceColumn={comparisonColumn}
                        comparisonColumn={column}
                        rows={comparisonQueryByColumn.get(column)?.data}
                        isLoading={comparisonQueryByColumn.get(column)?.isLoading ?? true}
                        isError={comparisonQueryByColumn.get(column)?.isError ?? false}
                        differenceFilterActive={
                          activeDifferenceFilter?.kind === 'column' &&
                          activeDifferenceFilter.column === column
                        }
                        onDifferenceFilterChange={(active) => {
                          onDifferenceFilterChange(active ? { kind: 'column', column } : null);
                        }}
                      />
                    ) : (
                      column
                    )}
                  </TableHead>
                ))}
                {correctionColumn ? (
                  <>
                    <TableHead className="w-8 px-1 text-center" aria-label="changes to">
                      <ArrowRight aria-hidden="true" className="mx-auto size-4" />
                    </TableHead>
                    <TableHead className="w-px whitespace-nowrap">
                      {activeComparisonColumns.includes(correctionColumn) ? (
                        <ColumnComparisonHeader
                          label={`Correction: ${correctionColumn}`}
                          metric={reliabilityMetric}
                          referenceColumn={comparisonColumn}
                          comparisonColumn={correctionColumn}
                          rows={comparisonQueryByColumn.get(correctionColumn)?.data}
                          isLoading={
                            comparisonQueryByColumn.get(correctionColumn)?.isLoading ?? true
                          }
                          isError={comparisonQueryByColumn.get(correctionColumn)?.isError ?? false}
                          differenceFilterActive={
                            activeDifferenceFilter?.kind === 'column' &&
                            activeDifferenceFilter.column === correctionColumn
                          }
                          onDifferenceFilterChange={(active) => {
                            onDifferenceFilterChange(
                              active ? { kind: 'column', column: correctionColumn } : null,
                            );
                          }}
                        />
                      ) : (
                        <>Correction: {correctionColumn}</>
                      )}
                    </TableHead>
                  </>
                ) : null}
                {supplementalColumns.map((column) => (
                  <TableHead key={column}>
                    {activeComparisonColumns.includes(column) ? (
                      <ColumnComparisonHeader
                        metric={reliabilityMetric}
                        referenceColumn={comparisonColumn}
                        comparisonColumn={column}
                        rows={comparisonQueryByColumn.get(column)?.data}
                        isLoading={comparisonQueryByColumn.get(column)?.isLoading ?? true}
                        isError={comparisonQueryByColumn.get(column)?.isError ?? false}
                        differenceFilterActive={
                          activeDifferenceFilter?.kind === 'column' &&
                          activeDifferenceFilter.column === column
                        }
                        onDifferenceFilterChange={(active) => {
                          onDifferenceFilterChange(active ? { kind: 'column', column } : null);
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
              {page.rows.map((row) => {
                const rowPosition = Number(row[sourceRowIndexColumn]);
                const referenceValue = row[comparisonColumn];
                const correctionKey = correctionColumn
                  ? `${correctionColumn}:${String(rowPosition)}`
                  : '';
                const seededCorrection = correctionColumn
                  ? row[correctionColumn] == null
                    ? null
                    : displayCell(row[correctionColumn])
                  : null;
                const hasCorrectionSelection = Object.hasOwn(correctionSelections, correctionKey);
                const correctionValue = hasCorrectionSelection
                  ? (correctionSelections[correctionKey] ?? null)
                  : seededCorrection;
                const comparisonValue = (column: string): unknown =>
                  column === correctionColumn ? correctionValue : row[column];
                const referenceDiffers = activeComparisonColumns.some((column) =>
                  annotationValuesDiffer(referenceValue, comparisonValue(column)),
                );
                const differenceColor = toBgColor(sourceColor);
                return (
                  <TableRow key={rowPosition}>
                    {visibleRequiredColumns.map((column) => {
                      const comparisonDiffers =
                        activeComparisonColumns.includes(column) &&
                        annotationValuesDiffer(referenceValue, row[column]);
                      const highlighted =
                        (column === comparisonColumn && referenceDiffers) || comparisonDiffers;
                      return (
                        <TableCell
                          key={column}
                          className="max-w-96 whitespace-pre-wrap"
                          style={highlighted ? { backgroundColor: differenceColor } : undefined}
                        >
                          {displayCell(row[column])}
                        </TableCell>
                      );
                    })}
                    {correctionColumn ? (
                      <>
                        <TableCell className="w-8 px-1 text-center">
                          <ArrowRight
                            role="img"
                            aria-label="corrected to"
                            className="mx-auto size-4 text-muted-foreground"
                          />
                        </TableCell>
                        <TableCell
                          className="w-px"
                          style={
                            activeComparisonColumns.includes(correctionColumn) &&
                            annotationValuesDiffer(referenceValue, correctionValue)
                              ? { backgroundColor: differenceColor }
                              : undefined
                          }
                        >
                          <Select
                            value={correctionValue ?? NO_CORRECTION_VALUE}
                            disabled={savingCorrectionRows.has(correctionKey)}
                            onValueChange={(next) => {
                              const resolved = next === NO_CORRECTION_VALUE ? null : next;
                              const previous = correctionValue;
                              const queryKey = queryKeys.annotationColumnComparison(
                                workspaceId,
                                [nodeId],
                                sql,
                                comparisonColumn,
                                correctionColumn,
                              );
                              setCorrectionSelections((current) => ({
                                ...current,
                                [correctionKey]: resolved,
                              }));
                              setSavingCorrectionRows((current) =>
                                new Set(current).add(correctionKey),
                              );
                              void queryClient
                                .cancelQueries({ queryKey, exact: true })
                                .then(() =>
                                  setCell(nodeId, correctionColumn, rowPosition, resolved),
                                )
                                .then(() => {
                                  const current =
                                    queryClient.getQueryData<ConfusionCount[]>(queryKey);
                                  if (current) {
                                    queryClient.setQueryData<ConfusionCount[]>(
                                      queryKey,
                                      applyComparisonValueEdit(current, {
                                        reference:
                                          referenceValue == null
                                            ? null
                                            : displayCell(referenceValue),
                                        previousComparison: previous,
                                        nextComparison: resolved,
                                      }),
                                    );
                                  } else {
                                    void queryClient.refetchQueries({
                                      queryKey,
                                      exact: true,
                                      type: 'active',
                                    });
                                  }
                                  return page.refreshFilteredRows();
                                })
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
                              className="h-8 min-w-28 text-sm"
                            >
                              <SelectValue placeholder="None" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_CORRECTION_VALUE}>None</SelectItem>
                              {correction.classOptions.map((name) => (
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
                      const comparisonDiffers =
                        activeComparisonColumns.includes(column) &&
                        annotationValuesDiffer(referenceValue, comparisonValue(column));
                      return (
                        <TableCell
                          key={column}
                          className="max-w-96 whitespace-pre-wrap"
                          style={
                            comparisonDiffers ? { backgroundColor: differenceColor } : undefined
                          }
                        >
                          {displayCell(comparisonValue(column))}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </AnalysisTableFrame>
      )}
    </section>
  );
}
