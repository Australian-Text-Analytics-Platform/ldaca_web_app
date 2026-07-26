import { useQueries } from '@tanstack/react-query';
import { queryWorkspaceSqlTable, sqlIdentifier } from '@/api';
import type { ConfusionCount } from '@/features/views/common/columnComparisonModel';
import { queryKeys } from '@/lib/queryKeys';

const COMPARISON_PAGE_SIZE = 500;
const REFERENCE_ALIAS = '__reference';
const COMPARISON_ALIAS = '__comparison';
const COUNT_ALIAS = '__count';

const displayCell = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const numericCount = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const fullColumnComparisonSql = (
  sql: string,
  referenceColumn: string,
  comparisonColumn: string,
): string => {
  const reference = sqlIdentifier(referenceColumn);
  const comparison = sqlIdentifier(comparisonColumn);
  return `SELECT ${reference} AS ${sqlIdentifier(REFERENCE_ALIAS)}, ${comparison} AS ${sqlIdentifier(COMPARISON_ALIAS)}, COUNT(*) AS ${sqlIdentifier(COUNT_ALIAS)} FROM (${sql}) AS ${sqlIdentifier('__annotation_comparison_source')} WHERE ${reference} IS NOT NULL AND ${comparison} IS NOT NULL GROUP BY ${reference}, ${comparison} ORDER BY ${reference} ASC NULLS FIRST, ${comparison} ASC NULLS FIRST`;
};

interface FullColumnComparisonArgs {
  workspaceId: string | null;
  nodeIds: string[];
  sql: string;
  referenceColumn: string;
  comparisonColumns: string[];
}

/** Loads complete grouped counts for one reference column and each selected target column. */
export function useFullColumnComparisons({
  workspaceId,
  nodeIds,
  sql,
  referenceColumn,
  comparisonColumns,
}: FullColumnComparisonArgs) {
  return useQueries({
    queries: comparisonColumns.map((comparisonColumn) => ({
      queryKey: queryKeys.annotationColumnComparison(
        workspaceId ?? '',
        nodeIds,
        sql,
        referenceColumn,
        comparisonColumn,
      ),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        if (!workspaceId) throw new Error('Missing workspace ID');
        const aggregateSql = fullColumnComparisonSql(sql, referenceColumn, comparisonColumn);
        const rows: ConfusionCount[] = [];
        let page = 1;
        let initialEtag: string | null | undefined;
        let hasNext: boolean;
        do {
          const aggregate = await queryWorkspaceSqlTable({
            path: { workspace_id: workspaceId },
            body: {
              mode: 'query',
              node_ids: nodeIds,
              sql: aggregateSql,
              page,
              page_size: COMPARISON_PAGE_SIZE,
            },
            signal,
          });
          initialEtag ??= aggregate.etag;
          if (initialEtag !== aggregate.etag) {
            throw new Error('Workspace changed while loading the annotation comparison');
          }
          rows.push(
            ...aggregate.rows.map((row) => ({
              reference: displayCell(row[REFERENCE_ALIAS]),
              comparison: displayCell(row[COMPARISON_ALIAS]),
              count: numericCount(row[COUNT_ALIAS]),
            })),
          );
          hasNext = aggregate.hasNext;
          page += 1;
        } while (hasNext);
        return rows;
      },
      enabled: Boolean(workspaceId),
      staleTime: 0,
      refetchOnMount: 'always' as const,
    })),
  });
}
