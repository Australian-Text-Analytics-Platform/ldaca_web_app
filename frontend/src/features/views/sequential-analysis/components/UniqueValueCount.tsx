import { useQuery } from '@tanstack/react-query';
import { getNodeRowsTable } from '@/api';
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
      const response = await getNodeRowsTable({
        path: { workspace_id: workspaceId, node_id: nodeId },
        query: { page: 1, page_size: 1000 },
      });
      const values = response.rows.map((row) => row[columnName]);
      return {
        unique_count: new Set(values.filter((value) => value !== null)).size,
        has_null: values.some((value) => value === null),
      };
    },
    enabled: !!workspaceId && !!nodeId && !!columnName,
  });

  if (isLoading) {
    return <span className="text-xs text-gray-500 px-2">Loading...</span>;
  }

  // Pill is a nice-to-have hint, not load-bearing. Render nothing on
  // error so we don't flag the user with a red "Error" badge — most
  // failure modes such as transient backend hiccups are recoverable on their own
  // and don't warrant a prominent error UI on a parameter dropdown.
  if (error || !data) {
    return null;
  }

  return (
    <span className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
      {data.unique_count} unique{data.has_null ? ' + null' : ''}
    </span>
  );
}
