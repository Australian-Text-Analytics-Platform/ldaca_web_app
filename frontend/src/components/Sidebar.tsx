import React from 'react';
import { useWorkspace } from '../hooks/useWorkspace';

interface SidebarProps {
  activeTab: 'data-loader' | 'filter' | 'token-frequency' | 'concordance' | 'analysis' | 'export';
  onTabChange: (tab: 'data-loader' | 'filter' | 'token-frequency' | 'concordance' | 'analysis' | 'export') => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const { 
    workspaceGraph,
    selectedNodeIds,
    toggleNodeSelection,
  } = useWorkspace();
  
  // Use workspaceGraph.nodes as the single source of truth for node count
  const nodeCount = workspaceGraph?.nodes?.length || 0;

  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col h-full">
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
  {/* spacer */}
  <div className="mt-6" />

      {/* Node list (synced with graph selection) */}
      <div className="mt-4 pt-3 border-t border-gray-200 flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">Nodes</h4>
          <span className="text-xs text-gray-500">{nodeCount}</span>
        </div>
        <div className="overflow-y-auto pr-1" style={{ maxHeight: '100%' }}>
          {(workspaceGraph?.nodes || []).map((n: any) => {
            const name = n?.data?.nodeName || n?.data?.label || n?.label || n?.id;
            const dtype = n?.data?.nodeType || n?.data?.dataType || n?.type || 'unknown';
            const shape = Array.isArray(n?.data?.shape) ? `${n.data.shape[0]} x ${n.data.shape[1]}` : '';
            const title = `Name: ${name}\nID: ${n.id}\nType: ${dtype}${shape ? `\nShape: ${shape}` : ''}`;
            const checked = (selectedNodeIds || []).includes(n.id);
            return (
              <label key={n.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-50 cursor-pointer" title={title}>
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={checked}
                  onChange={() => toggleNodeSelection(n.id)}
                />
                <span className="text-sm text-gray-700 truncate" style={{ maxWidth: '11rem' }}>{name}</span>
              </label>
            );
          })}
          {(!workspaceGraph?.nodes || workspaceGraph.nodes.length === 0) && (
            <div className="text-xs text-gray-500 px-2 py-1">No nodes</div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
