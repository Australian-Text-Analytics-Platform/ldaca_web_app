import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef, PaginationState } from '@tanstack/react-table';
import { queryWorkspaceSqlTable } from '@/api';
import { Button } from '@/components/ui/button';
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
  ColumnComparisonDialog,
  ConfusionMatrix,
} from '@/features/views/common/components/ColumnComparison';
import { MetadataColumnSelector } from '@/features/views/common/components/MetadataColumnSelector';
import { ServerPaginationFooter } from '@/features/views/common/components/ServerPaginationFooter';
import { useServerTable } from '@/features/views/common/hooks/useServerTable';
import { useFullColumnComparisons } from '@/features/views/common/hooks/useFullColumnComparisons';
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
  rowCount,
}: RunAllReviewTableProps) {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [draftComparisonColumns, setDraftComparisonColumns] = useState<string[]>([]);
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
  const comparisonQueries = useFullColumnComparisons({
    workspaceId,
    nodeIds,
    sql,
    referenceColumn: comparisonColumn,
    comparisonColumns: activeComparisonColumns,
  });
  const visibleColumns = data
    ? Array.from(
        new Set([
          ...requiredColumns.filter((column) => data.columns.includes(column)),
          ...activeComparisonColumns,
          ...availableMetadataColumns.filter((column) => selectedMetadataColumns.includes(column)),
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={availableComparisonColumns.length === 0}
              onClick={() => {
                setDraftComparisonColumns(activeComparisonColumns);
                setCompareDialogOpen(true);
              }}
            >
              Compare To
            </Button>
            <MetadataColumnSelector
              availableColumns={availableMetadataColumns}
              selectedColumns={selectedMetadataColumns}
              onSelectedColumnsChange={setSelectedMetadataColumns}
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
                  <TableHead key={column}>{column}</TableHead>
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
      {activeComparisonColumns.length > 0 ? (
        <div className="mt-4 space-y-4" aria-label="Annotation comparisons">
          {activeComparisonColumns.map((targetColumn, index) => {
            const comparisonQuery = comparisonQueries[index];
            return (
              <ConfusionMatrix
                key={targetColumn}
                referenceColumn={comparisonColumn}
                comparisonColumn={targetColumn}
                rows={comparisonQuery?.data}
                isLoading={comparisonQuery?.isLoading ?? true}
                isError={comparisonQuery?.isError ?? false}
              />
            );
          })}
        </div>
      ) : null}
      <ColumnComparisonDialog
        open={compareDialogOpen}
        referenceColumn={comparisonColumn}
        availableColumns={availableComparisonColumns}
        selectedColumns={draftComparisonColumns}
        scopeDescription="across the full Data Block"
        onOpenChange={setCompareDialogOpen}
        onSelectedColumnsChange={setDraftComparisonColumns}
        onCompare={() => {
          onComparisonColumnsChange(draftComparisonColumns);
          setCompareDialogOpen(false);
        }}
      />
    </section>
  );
}
