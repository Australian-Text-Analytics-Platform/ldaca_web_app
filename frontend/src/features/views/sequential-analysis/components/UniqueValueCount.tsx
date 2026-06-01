import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { getColumnUniqueValues } from '@/api/generated/sdk.gen';
import { queryKeys } from '@/lib/queryKeys';

interface UniqueValueCountProps {
  workspaceId: string;
  nodeId: string;
  columnName: string;
}

/**
 * Rendered by: SequentialAnalysisParameterPanel to show cardinality hints for candidate group-by columns because the analysis route needs this component to assemble the selected tab state, controls, task lifecycle, and results surface.
 * Flow: normalize inputs, derive state, then return the analysis result expected by callers.
 */
export function UniqueValueCount({ workspaceId, nodeId, columnName }: UniqueValueCountProps) {
  const { getAuthHeaders } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.columnUniqueValues(workspaceId, nodeId, columnName),
    // Used by: UniqueValueCount query to fetch metadata that informs group-by decisions because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
    queryFn: async () => {
      const { data: response } = await getColumnUniqueValues({
        headers: getAuthHeaders(),
        path: { column_name: columnName, node_id: nodeId },
        throwOnError: true,
      });
      return response;
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
