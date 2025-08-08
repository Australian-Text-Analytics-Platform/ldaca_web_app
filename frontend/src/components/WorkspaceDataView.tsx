import React, { memo, useState, useEffect } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { TableLoadingSkeleton, EmptyState } from './LoadingStates';
import JoinInterface from './JoinInterface';
import DataTable from './DataTable';

/**
 * Separated data view component focused only on data table rendering
 * This replaces the data table logic from the monolithic WorkspaceView
 */
export const WorkspaceDataView: React.FC = memo(() => {
  const { 
    selectedNode, 
    selectedNodes,
    currentWorkspaceId,
    nodeData, 
    isLoading,
    joinNodes,
    castColumn,
    refreshNodeSchema,
    getNodeShape,
    clearSelection,
    handlePageChange,
    handlePageSizeChange
  } = useWorkspace();

  const [actualShape, setActualShape] = useState<[number, number] | null>(null);
  const [isLoadingShape, setIsLoadingShape] = useState(false);

  // Fetch actual shape when selectedNode changes and has null shape
  useEffect(() => {
    if (selectedNode && selectedNode.data?.shape?.[0] === null && getNodeShape) {
      setIsLoadingShape(true);
      getNodeShape(selectedNode.id)
        .then((shapeData) => {
          if (shapeData && shapeData.shape) {
            setActualShape(shapeData.shape as [number, number]);
          }
        })
        .catch((error) => {
          console.error('Failed to fetch actual shape:', error);
        })
        .finally(() => {
          setIsLoadingShape(false);
        });
    } else {
      setActualShape(null);
      setIsLoadingShape(false);
    }
  }, [selectedNode, getNodeShape]); // Now safe with stable getNodeShape

  // Helper function to get display shape
  const getDisplayShape = (): [number | string, number | string] => {
    if (selectedNode?.data?.shape) {
      const [rows, cols] = selectedNode.data.shape;
      if (rows === null) {
        // If we have fetched the actual shape, use it, otherwise show loading or ?
        if (actualShape) {
          return actualShape;
        } else if (isLoadingShape) {
          return ['...', cols];
        } else {
          return ['?', cols];
        }
      } else {
        return [rows, cols];
      }
    }
    return ['?', '?'];
  };

  if (isLoading.nodeData) {
    return (
      <div className="p-6">
        <TableLoadingSkeleton />
      </div>
    );
  }

  // Handle multi-selection: show join interface when multiple nodes are selected
  if (selectedNodes.length > 1) {
    // For now, only handle exactly 2 nodes (binary join)
    if (selectedNodes.length === 2) {
      const [leftNode, rightNode] = selectedNodes;
      
      // Create WorkspaceNode-compatible objects from React Flow nodes
      const leftNodeForJoin = {
        node_id: leftNode.id,
        name: leftNode.data?.nodeName || leftNode.data?.label || leftNode.id,
        shape: leftNode.data?.shape || [0, 0],
        columns: leftNode.data?.columns || [],
        preview: [],
        is_text_data: leftNode.data?.isTextData || false,
        data_type: leftNode.data?.dataType || 'unknown',
        column_schema: leftNode.data?.schema ? 
          Object.fromEntries(leftNode.data.schema.map((col: any) => [col.name, col.js_type])) : {},
        dtypes: leftNode.data?.schema ? 
          Object.fromEntries(leftNode.data.schema.map((col: any) => [col.name, col.js_type])) : {},
        is_lazy: leftNode.data?.isLazy || false,
      };
      
      const rightNodeForJoin = {
        node_id: rightNode.id,
        name: rightNode.data?.nodeName || rightNode.data?.label || rightNode.id,
        shape: rightNode.data?.shape || [0, 0],
        columns: rightNode.data?.columns || [],
        preview: [],
        is_text_data: rightNode.data?.isTextData || false,
        data_type: rightNode.data?.dataType || 'unknown',
        column_schema: rightNode.data?.schema ? 
          Object.fromEntries(rightNode.data.schema.map((col: any) => [col.name, col.js_type])) : {},
        dtypes: rightNode.data?.schema ? 
          Object.fromEntries(rightNode.data.schema.map((col: any) => [col.name, col.js_type])) : {},
        is_lazy: rightNode.data?.isLazy || false,
      };
      
      const handleJoin = async (
        leftNodeId: string,
        rightNodeId: string,
        joinColumns: { left: string; right: string },
        joinType: 'inner' | 'left' | 'right' | 'outer',
        newNodeName: string
      ) => {
        const result = await joinNodes(
          leftNodeId,
          rightNodeId,
          joinType,
          [joinColumns.left],
          [joinColumns.right],
          newNodeName
        );
        return result;
      };

      const handleCancel = () => {
        clearSelection();
      };

      return (
        <div className="p-6">
          <JoinInterface
            leftNode={leftNodeForJoin}
            rightNode={rightNodeForJoin}
            onJoin={handleJoin}
            onCancel={handleCancel}
            loading={isLoading.operations}
          />
        </div>
      );
    } else {
      // More than 2 nodes selected - not supported yet
      return (
        <EmptyState
          title="Multiple Nodes Selected"
          description={`${selectedNodes.length} nodes selected. Join operations currently support only 2 nodes at a time.`}
          icon={
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      );
    }
  }

  if (!selectedNode) {
    return (
      <EmptyState
        title="No Node Selected"
        description="Select a node from the graph to view its data"
        icon={
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        }
      />
    );
  }

  if (!nodeData.data || nodeData.data.length === 0) {
    return (
      <EmptyState
        title="No Data Available"
        description="The selected node contains no data"
        icon={
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Node info header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-200 bg-gray-50">
        <h3 className="text-lg font-semibold text-gray-800">
          {selectedNode.data?.nodeName || selectedNode.data?.label || selectedNode.id}
        </h3>
        <div className="text-sm text-gray-600 mt-1">
          Shape: {(() => {
            const [rows, cols] = getDisplayShape();
            return `${rows} × ${cols}`;
          })()} | {nodeData.data.length} rows loaded
        </div>
      </div>

      {/* Data table with column type casting */}
      <div className="flex-1 overflow-auto">
        <DataTable
          data={nodeData.data}
          loading={isLoading.nodeData}
          workspaceId={currentWorkspaceId}
          nodeId={selectedNode.id}
          onCast={async (column: string, targetType: string, format?: string) => {
            await castColumn(selectedNode.id, column, targetType, format);
          }}
          onRefreshSchema={async () => {
            return await refreshNodeSchema(selectedNode.id);
          }}
          pagination={nodeData.pagination}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
    </div>
  );
});

WorkspaceDataView.displayName = 'WorkspaceDataView';
