import { useQuery } from '@tanstack/react-query';
import { queryWorkspaceSqlTable, sqlIdentifier, sqlTable } from '@/api';
import { queryKeys } from '@/lib/queryKeys';

interface UniqueValueCountProps {
  workspaceId: string;
  nodeId: string;
  columnName: string;
}

/**
 * Rendered by: SequentialAnalysisParameterPanel to show cardinality hints for candidate group-by columns.
 * Flow: query distinct values for the selected column, then render loading,
 * error, or the returned count.
 */
export function UniqueValueCount({ workspaceId, nodeId, columnName }: UniqueValueCountProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.columnUniqueValues(workspaceId, nodeId, columnName),
    // Used by: UniqueValueCount query to fetch metadata that informs group-by decisions.
    queryFn: async () => {
      const column = sqlIdentifier(columnName);
      const response = await queryWorkspaceSqlTable({
        path: { workspace_id: workspaceId },
        body: {
          mode: 'query',
          node_ids: [nodeId],
          sql: `SELECT COUNT(DISTINCT ${column}) AS unique_count, COUNT(*) > COUNT(${column}) AS has_null FROM ${sqlTable(nodeId)}`,
          page: 1,
          page_size: 1,
        },
      });
      const row = response.rows[0];
      return {
        unique_count: Number(row?.unique_count ?? 0),
        has_null: row?.has_null === true,
      };
    },
    enabled: !!workspaceId && !!nodeId && !!columnName,
  });

  if (isLoading) {
    return <span className="text-label-secondary text-description px-2">Loading...</span>;
  }

  // Pill is a nice-to-have hint, not load-bearing. Render nothing on
  // error so we don't flag the user with a red "Error" badge — most
  // failure modes such as transient backend hiccups are recoverable on their own
  // and don't warrant a prominent error UI on a parameter dropdown.
  if (error || !data) {
    return null;
  }

  return (
    <span className="text-label-secondary text-description bg-panel px-2 py-1 rounded-sm">
      {data.unique_count} unique{data.has_null ? ' + null' : ''}
    </span>
  );
}
