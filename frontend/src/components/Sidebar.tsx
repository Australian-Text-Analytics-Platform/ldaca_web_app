import React from 'react';
import { useWorkspace } from '../hooks/useWorkspace';

interface SidebarProps {
  activeTab: 'data-loader' | 'filter' | 'token-frequency' | 'concordance' | 'analysis' | 'export';
  onTabChange: (tab: 'data-loader' | 'filter' | 'token-frequency' | 'concordance' | 'analysis' | 'export') => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const { 
    workspaces,
    currentWorkspace, 
    currentWorkspaceId,
    workspaceGraph,
    isLoading,
    errors 
  } = useWorkspace();
  
  // Use workspaceGraph.nodes as the single source of truth for node count
  const nodeCount = workspaceGraph?.nodes?.length || 0;

  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-4">
      <nav className="space-y-2">
        <button
          onClick={() => onTabChange('data-loader')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'data-loader'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📁 Data Loader
        </button>
        <button
          onClick={() => onTabChange('filter')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'filter'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          🔍 Filter/Slicing
        </button>
        <button
          onClick={() => onTabChange('token-frequency')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'token-frequency'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📈 Token Frequency
        </button>
        <button
          onClick={() => onTabChange('concordance')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'concordance'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📝 Concordance
        </button>
        <button
          onClick={() => onTabChange('analysis')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'analysis'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📊 Timeline
        </button>
        <button
          onClick={() => onTabChange('export')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'export'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📤 Export
        </button>
      </nav>

      {/* Workspace Info */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Current Workspace</h3>
        
                {isLoading.workspaces ? (
          <div className="text-sm text-gray-500">Loading workspaces...</div>
        ) : errors.workspaces ? (
          <div className="text-sm text-red-500">Error: {errors.workspaces}</div>
        ) : currentWorkspace ? (
          <div className="bg-gray-50 p-3 rounded-lg">
            <p className="text-sm font-medium text-gray-700">Current Workspace</p>
            <p className="text-sm text-gray-900">{currentWorkspace.name}</p>
            <p className="text-xs text-gray-500 mt-1">
              {nodeCount} nodes
            </p>
          </div>
        ) : (
          <div className="text-sm text-gray-500">No workspace selected</div>
        )}

        {/* Debug info */}
        <div className="mt-4 p-2 bg-gray-100 rounded text-xs text-gray-600">
          <div>Total workspaces: {workspaces.length}</div>
          <div>Current ID: {currentWorkspaceId || 'none'}</div>
          {workspaces.map((w: any) => (
            <div key={w.workspace_id}>
              {w.workspace_id === currentWorkspaceId ? '→ ' : '  '}
              {w.name} ({w.workspace_id.slice(0, 8)})
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
