import React, { memo } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';

/**
 * Separated controls component focused only on workspace controls
 * Removed view mode toggle since both views are now shown vertically
 */
export const WorkspaceControls: React.FC = memo(() => {
  const { 
    currentWorkspace,
    workspaceGraph,
    selectedNodeIds
  } = useWorkspace();

  // Use workspaceGraph.nodes as the single source of truth for node count
  const nodeCount = workspaceGraph?.nodes?.length || 0;

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        {/* Workspace info */}
        <div className="flex items-center space-x-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">
              {currentWorkspace?.name || 'No Workspace'}
            </h2>
            <div className="text-sm text-gray-600">
              {nodeCount} nodes • {selectedNodeIds.length} selected
            </div>
          </div>
        </div>

        {/* Additional controls can be added here if needed */}
        <div className="flex items-center space-x-4">
          {/* Placeholder for future controls */}
        </div>
      </div>
    </div>
  );
});

WorkspaceControls.displayName = 'WorkspaceControls';
