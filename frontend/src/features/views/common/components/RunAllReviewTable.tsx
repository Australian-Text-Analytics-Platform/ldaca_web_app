import type { ColumnDef } from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AnalysisTableFrame } from '@/features/views/common/components/AnalysisTableScrollArea';
import {
  ColumnComparisonHeader,
  ColumnComparisonSelector,
} from '@/features/views/common/components/ColumnComparison';
import type { IntercoderReliabilityMetric } from '@/features/views/common/columnComparisonModel';
import { CorrectionColumnVisibilityButton } from '@/features/views/common/components/CorrectionColumnVisibilityButton';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useFullColumnComparisons } from '@/features/views/common/hooks/useFullColumnComparisons';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { annotationValuesDiffer } from '@/features/views/annotation/annotationDifferenceQuery';
import { useAnnotationNodePage } from '@/features/views/annotation/hooks/useAnnotationNodePage';
import { toBgColor } from '@/features/views/common/vizPalette';

const DEFAULT_PAGE_SIZE = 10;

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
  requiredColumns: string[];
  comparisonColumn: string;
  comparisonColumns: string[];
  onComparisonColumnsChange: (columns: string[]) => void;
  differenceFilterColumns: string[];
  onDifferenceFilterColumnsChange: (columns: string[]) => void;
  reliabilityMetric: IntercoderReliabilityMetric;
  onReliabilityMetricChange: (metric: IntercoderReliabilityMetric) => void;
  metadataColumns: string[];
  onMetadataColumnsChange: (columns: string[]) => void;
  correction?: {
    column: string;
    visible: boolean;
    onVisibleChange: (visible: boolean) => void;
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
  requiredColumns,
  comparisonColumn,
  comparisonColumns,
  onComparisonColumnsChange,
  differenceFilterColumns,
  onDifferenceFilterColumnsChange,
  reliabilityMetric,
  onReliabilityMetricChange,
  metadataColumns,
  onMetadataColumnsChange,
  correction,
  rowCount,
}: RunAllReviewTableProps) {
  const activeDifferenceFilterColumns = differenceFilterColumns.filter((column) =>
    comparisonColumns.includes(column),
  );
  const page = useAnnotationNodePage({
    workspaceId,
    nodeId,
    sourceSql: sql,
    sourceColumns,
    annotationColumn: comparisonColumn,
    differenceColumns: activeDifferenceFilterColumns,
    rowCount,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const { pagination, setPagination, query, countQuery, sourceRowIndexColumn } = page;
  const data = query.data;
  const dataColumns = data?.columns.filter((column) => column !== sourceRowIndexColumn);
  const requiredColumnSet = new Set(requiredColumns);
  const availableMetadataColumns =
    dataColumns?.filter((column) => !requiredColumnSet.has(column)) ?? [];
  const comparableColumnSet = new Set(
    data?.schema
      .filter((column) => column.name !== sourceRowIndexColumn)
      .filter((column) => column.kind === 'string' || column.kind === 'categorical')
      .map((column) => column.name) ?? [],
  );
  const comparisonExcludedColumns = new Set([requiredColumns[0], comparisonColumn]);
  const availableComparisonColumns =
    dataColumns?.filter(
      (column) => !comparisonExcludedColumns.has(column) && comparableColumnSet.has(column),
    ) ?? [];
  const activeComparisonColumns = comparisonColumns.filter((column) =>
    availableComparisonColumns.includes(column),
  );
  const activeMetadataColumns = metadataColumns.filter((column) =>
    availableMetadataColumns.includes(column),
  );
  const visibleRequiredColumns = requiredColumns.filter(
    (column) => column !== correction?.column || correction.visible,
  );
  const displayedComparisonColumns = activeComparisonColumns.filter(
    (column) => column !== correction?.column || correction.visible,
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
  const visibleColumns = dataColumns
    ? Array.from(
        new Set([
          ...visibleRequiredColumns.filter((column) => dataColumns.includes(column)),
          ...displayedComparisonColumns,
          ...activeMetadataColumns,
        ]),
      )
    : [];
  const tableColumns: ColumnDef<Record<string, unknown>>[] = visibleColumns.map((column) => ({
    id: column,
    accessorFn: (row) => row[column],
  }));
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
        <h3 className="text-base font-semibold">{title} Review</h3>
        {data ? (
          <div className="flex flex-wrap items-center gap-2">
            <ColumnComparisonSelector
              availableColumns={availableComparisonColumns}
              selectedColumns={activeComparisonColumns}
              onSelectedColumnsChange={onComparisonColumnsChange}
              metric={reliabilityMetric}
              onMetricChange={onReliabilityMetricChange}
            />
            {correction ? (
              <CorrectionColumnVisibilityButton
                visible={correction.visible}
                onVisibleChange={correction.onVisibleChange}
              />
            ) : null}
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
                {visibleColumns.map((column) => (
                  <TableHead key={column}>
                    {activeComparisonColumns.includes(column) ? (
                      <ColumnComparisonHeader
                        metric={reliabilityMetric}
                        referenceColumn={comparisonColumn}
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
              {page.rows.map((row) => {
                const referenceValue = row[comparisonColumn];
                const referenceDiffers = activeComparisonColumns.some((column) =>
                  annotationValuesDiffer(referenceValue, row[column]),
                );
                const differenceColor = toBgColor(sourceColor);
                return (
                  <TableRow key={String(row[sourceRowIndexColumn])}>
                    {visibleColumns.map((column) => {
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
