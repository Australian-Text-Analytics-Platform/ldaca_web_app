import React from 'react';
import FeedbackModal from './FeedbackModal';
import { useWorkspace } from '../hooks/useWorkspace';

interface SidebarProps {
  activeTab: 'data-loader' | 'filter' | 'token-frequency' | 'topic-modeling' | 'concordance' | 'analysis' | 'export';
  onTabChange: (tab: 'data-loader' | 'filter' | 'token-frequency' | 'topic-modeling' | 'concordance' | 'analysis' | 'export') => void;
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
          � Timeline
        </button>
        <button
          onClick={() => onTabChange('topic-modeling')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'topic-modeling'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          🧩 Topic Modeling
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
      {/* Feedback button fixed at bottom */}
      <div className="pt-3 mt-4 border-t border-gray-200">
        <FeedbackButton />
      </div>
      <FeedbackModalWrapper />
    </aside>
  );
};

export default Sidebar;

// Local state wrapper components (placed after export for file locality)
const FeedbackContext = React.createContext<{open:boolean; setOpen:(v:boolean)=>void}|null>(null);

const FeedbackModalWrapper: React.FC = () => {
  const ctx = React.useContext(FeedbackContext);
  if (!ctx) return null;
  return <FeedbackModal isOpen={ctx.open} onClose={()=>ctx.setOpen(false)} />;
};

const FeedbackButton: React.FC = () => {
  const [open,setOpen] = React.useState(false);
  return (
    <FeedbackContext.Provider value={{open,setOpen}}>
      <button onClick={()=>setOpen(true)} className="w-full px-4 py-2 text-sm rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2" title="Send feedback or report an issue">
        💬 Feedback
      </button>
      <FeedbackModalWrapper />
    </FeedbackContext.Provider>
  );
};
