import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../hooks/useAuth';
import { nodesApi } from '../../../../api/index';

interface UniqueValueCountProps {
  workspaceId: string;
  nodeId: string;
  columnName: string;
}

export const UniqueValueCount: React.FC<UniqueValueCountProps> = ({ workspaceId, nodeId, columnName }) => {
  const { getAuthHeaders } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['columnUniqueValues', workspaceId, nodeId, columnName],
    queryFn: () => nodesApi.uniqueValues(nodeId, columnName, getAuthHeaders()),
    enabled: !!workspaceId && !!nodeId && !!columnName,
  });

  if (isLoading) {
    return <span className="text-xs text-gray-500 px-2">Loading...</span>;
  }

  if (error || !data) {
    return <span className="text-xs text-red-500 px-2">Error</span>;
  }

  return (
    <span className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
      {data.unique_count} unique{data.has_null ? ' + null' : ''}
    </span>
  );
};
