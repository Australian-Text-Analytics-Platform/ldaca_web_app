import React, { memo } from 'react';
import { WorkspaceGraphView } from './WorkspaceGraphView';
import { WorkspaceDataView } from './WorkspaceDataView';
import { WorkspaceControls } from './WorkspaceControls';

/**
 * Improved WorkspaceView with vertical layout showing both graph and data views
 * This replaces the tab-based layout with stacked views
 */
const WorkspaceView: React.FC = memo(() => {
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header with controls */}
      <div className="flex-shrink-0 border-b border-gray-200">
        <WorkspaceControls />
      </div>

      {/* Graph View - Upper half with explicit height constraint */}
      <div className="h-1/2 border-b border-gray-200 flex flex-col">
        <div className="p-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <h3 className="text-sm font-medium text-gray-700">Graph View</h3>
        </div>
        <div className="flex-1 min-h-0">
          <WorkspaceGraphView />
        </div>
      </div>

      {/* Data View - Lower half with explicit height constraint */}
      <div className="h-1/2 flex flex-col">
        <div className="p-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <h3 className="text-sm font-medium text-gray-700">Data View</h3>
        </div>
        <div className="flex-1 min-h-0">
          <WorkspaceDataView />
        </div>
      </div>
    </div>
  );
});

WorkspaceView.displayName = 'WorkspaceView';

export default WorkspaceView;
