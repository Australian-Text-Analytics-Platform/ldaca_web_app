import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { nodesApi } from '@/api/index';
import { queryKeys } from '@/lib/queryKeys';

interface UniqueValueCountProps {
  workspaceId: string;
  nodeId: string;
  columnName: string;
}

export const UniqueValueCount: React.FC<UniqueValueCountProps> = ({ workspaceId, nodeId, columnName }) => {
  const { getAuthHeaders } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.columnUniqueValues(workspaceId, nodeId, columnName),
    queryFn: () => nodesApi.uniqueValues(nodeId, columnName, getAuthHeaders()),
    enabled: !!workspaceId && !!nodeId && !!columnName,
  });

  if (isLoading) {
    return <span className="text-xs text-gray-500 px-2">Loading...</span>;
  }

  // Pill is a nice-to-have hint, not load-bearing. Render nothing on
  // error so we don't flag the user with a red "Error" badge — most
  // failure modes (snapshot view where the captured node isn't live-
  // queryable, transient backend hiccup) are recoverable on their own
  // and don't warrant a prominent error UI on a parameter dropdown.
  if (error || !data) {
    return null;
  }

  return (
    <span className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
      {data.unique_count} unique{data.has_null ? ' + null' : ''}
    </span>
  );
};
