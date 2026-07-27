import { useQuery } from '@tanstack/react-query';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { useState } from 'react';
import { queryWorkspaceSqlTable } from '@/api';
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
import { queryKeys } from '@/lib/queryKeys';

const DEFAULT_PAGE_SIZE = 10;

const displayCell = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

interface RunAllReviewTableProps {
  workspaceId: string;
  nodeIds: string[];
  sql: string;
  title: string;
  requiredColumns: string[];
  comparisonColumn: string;
  comparisonColumns: string[];
  onComparisonColumnsChange: (columns: string[]) => void;
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
  nodeIds,
  sql,
  title,
  requiredColumns,
  comparisonColumn,
  comparisonColumns,
  onComparisonColumnsChange,
  reliabilityMetric,
  onReliabilityMetricChange,
  metadataColumns,
  onMetadataColumnsChange,
  correction,
  rowCount,
}: RunAllReviewTableProps) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const query = useQuery({
    queryKey: queryKeys.workspaceSql(
      workspaceId,
      nodeIds,
      sql,
      pagination.pageIndex + 1,
      pagination.pageSize,
    ),
    queryFn: () =>
      queryWorkspaceSqlTable({
        path: { workspace_id: workspaceId },
        body: {
          mode: 'query',
          node_ids: nodeIds,
          sql,
          page: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
        },
      }),
  });
  const data = query.data;
  const requiredColumnSet = new Set(requiredColumns);
  const availableMetadataColumns =
    data?.columns.filter((column) => !requiredColumnSet.has(column)) ?? [];
  const comparableColumnSet = new Set(
    data?.schema
      .filter((column) => column.kind === 'string' || column.kind === 'categorical')
      .map((column) => column.name) ?? [],
  );
  const comparisonExcludedColumns = new Set([requiredColumns[0], comparisonColumn]);
  const availableComparisonColumns =
    data?.columns.filter(
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
    nodeIds,
    sql,
    referenceColumn: comparisonColumn,
    comparisonColumns: activeComparisonColumns,
  });
  const comparisonQueryByColumn = new Map(
    activeComparisonColumns.map((column, index) => [column, comparisonQueries[index]]),
  );
  const visibleColumns = data
    ? Array.from(
        new Set([
          ...visibleRequiredColumns.filter((column) => data.columns.includes(column)),
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
    data: data?.rows ?? [],
    columns: tableColumns,
    rowCount,
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
      {query.isError ? (
        <p className="text-sm text-destructive">Could not load Review.</p>
      ) : query.isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading Review...</p>
      ) : (
        <AnalysisTableFrame
          maxHeightClass="max-h-96"
          belowTable={
            <ServerPaginationFooter
              table={table}
              pageIndex={pagination.pageIndex}
              pageSize={pagination.pageSize}
              rowCount={rowCount}
              loading={query.isFetching}
            />
          }
        >
          <Table disableContainer>
            <TableHeader>
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
                      />
                    ) : (
                      column
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, rowIndex) => (
                <TableRow key={`${String(pagination.pageIndex)}:${String(rowIndex)}`}>
                  {visibleColumns.map((column) => (
                    <TableCell key={column} className="max-w-96 whitespace-pre-wrap">
                      {displayCell(row[column])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AnalysisTableFrame>
      )}
    </section>
  );
}
