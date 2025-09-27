import React from 'react';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceSelection } from '../../hooks/useWorkspaceSelection';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useAuth } from '../../hooks/useAuth';
import { workspacesApi } from '../../api/workspaces';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useUIStore } from '../../stores';
import { useShallow } from 'zustand/react/shallow';
import { useWorkspaceTaskStream } from '../../hooks/useWorkspaceTaskStream';

const Sidebar: React.FC = () => {
  const { currentView, setCurrentView, openFeedbackModal } = useUIStore(
    useShallow(({ currentView, setCurrentView, openFeedbackModal }) => ({ currentView, setCurrentView, openFeedbackModal }))
  );
  const { workspaceGraph, currentWorkspaceId } = useWorkspaceData();
  const { selectedNodeIds } = useWorkspaceSelection();
  const { toggleNodeSelection } = useWorkspaceActions();
  const { getAuthHeaders } = useAuth();
  const { tasks, setTasks } = useAnalysisStore() as any;
  const {
    status: taskStreamStatus,
    error: taskStreamError,
    reconnect: reconnectTaskStream,
  } = useWorkspaceTaskStream(currentWorkspaceId ?? null);
  const isConnected = taskStreamStatus === 'open';
  const isConnecting = taskStreamStatus === 'connecting';
  const connectionError = taskStreamStatus === 'error' ? taskStreamError : null;
  // Use workspaceGraph.nodes as the single source of truth for node count
  const nodeCount = workspaceGraph?.nodes?.length || 0;

  // Task stream state handled by useWorkspaceTaskStream; reconnectTaskStream available for manual retries.

  return (
    <aside className="w-64 bg-white border-r border-gray-200 p-4 flex flex-col h-full">
      <nav className="space-y-2">
        <button
          onClick={() => setCurrentView('data-loader')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'data-loader'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📁 Data Loader
        </button>
        <button
          onClick={() => setCurrentView('filter')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'filter'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          🔍 Filter/Slicing
        </button>
  <button
          onClick={() => setCurrentView('token-frequency')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'token-frequency'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📈 Token Frequency
        </button>
        <button
          onClick={() => setCurrentView('concordance')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'concordance'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📝 Concordance
        </button>
        <button
          onClick={() => setCurrentView('analysis')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'analysis'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          📊 Timeline
        </button>
        <button
          onClick={() => setCurrentView('topic-modeling')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'topic-modeling'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          🧩 Topic Modeling
        </button>
        <button
          onClick={() => setCurrentView('quotation')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'quotation'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          ❝ Quotation
        </button>
        <button
          onClick={() => setCurrentView('export')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            currentView === 'export'
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

      {/* Tasks list */}
      <div className="mt-4 pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">Tasks</h4>
          <div className="flex items-center gap-2">
            {connectionError ? (
              <button
                type="button"
                className="text-xs text-red-500 underline decoration-dotted decoration-red-400 underline-offset-2"
                title={`${connectionError}. Click to retry.`}
                onClick={() => reconnectTaskStream()}
              >
                ❌
              </button>
            ) : isConnected ? (
              <span className="text-xs text-green-500" title="Real-time updates active (SSE)">🟢</span>
            ) : (
              <span className="text-xs text-yellow-500 animate-pulse" title={isConnecting ? 'Connecting…' : 'Waiting for workspace'}>🟡</span>
            )}
          </div>
        </div>
        <div className="space-y-1">
          {Array.isArray(tasks) && tasks.length > 0 ? tasks.slice().sort((a:any,b:any)=>{
            const kb = (b.finished_at||b.started_at||b.created_at||0);
            const ka = (a.finished_at||a.started_at||a.created_at||0);
            return kb - ka;
          }).map((t:any)=>{
            const status = t.state as string;
            const icon = status === 'running' ? '⏳' : status === 'successful' ? '✅' : status === 'failed' ? '❌' : status === 'cancelled' ? '⏹️' : '⏺️';
            const color = status === 'running' ? 'text-amber-600' : status === 'successful' ? 'text-green-600' : status === 'failed' ? 'text-red-600' : status === 'cancelled' ? 'text-gray-600' : 'text-gray-600';
            return (
              <div key={t.task_id} className="flex flex-col px-2 py-1 rounded hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={color} title={status}>{icon}</span>
                    <div className="min-w-0">
                      <div className="text-xs text-gray-800 truncate">{t.task_type?.replace(/_/g,' ') || 'task'}{t.metadata?.name ? `: ${t.metadata.name}` : ''}</div>
                      <div className="text-[10px] text-gray-500 truncate" title={t.message || ''}>{t.message || ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {status === 'running' && currentWorkspaceId && (
                      <button
                        onClick={async ()=>{ 
                          try { 
                            await workspacesApi.cancelTasks(currentWorkspaceId, { task_id: t.task_id }, getAuthHeaders()); 
                            // Optimistically update the task status locally
                            setTasks((prevTasks: any[]) => 
                              prevTasks.map(task => 
                                task.task_id === t.task_id 
                                  ? { ...task, state: 'cancelled' } 
                                  : task
                              )
                            );
                          } catch(_){} 
                        }}
                        className="text-[10px] px-1.5 py-0.5 bg-red-200 text-red-800 rounded hover:bg-red-300 transition-colors"
                        title="Cancel task"
                      >
                        Cancel
                      </button>
                    )}
                    {(status === 'successful' || status === 'failed' || status === 'cancelled') && currentWorkspaceId && (
                      <button
                        onClick={async ()=>{ 
                          try { 
                            // Clear only the task record from backend (preserves analysis results)
                            await workspacesApi.clearTasks(currentWorkspaceId, { task_id: t.task_id }, getAuthHeaders()); 
                            // Remove the task from frontend state
                            setTasks((prevTasks: any[]) => 
                              prevTasks.filter(task => task.task_id !== t.task_id)
                            );
                          } catch(_){} 
                        }}
                        className="text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                        title="Clear task (keeps analysis results)"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                {/* Progress bar for running and completed tasks */}
                {(status === 'running' || status === 'successful') && typeof t.progress === 'number' && t.progress >= 0 && (
                  <div className="mt-1">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full transition-all duration-300 ${
                          status === 'successful' ? 'bg-green-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.min(100, t.progress * 100)}%` }}
                      ></div>
                    </div>
                    <div className="text-[9px] text-gray-400 mt-0.5">
                      {Math.round(t.progress * 100)}% {t.progress_message && `• ${t.progress_message}`}
                    </div>
                  </div>
                )}
              </div>
            );
          }) : (
            <div className="text-xs text-gray-500 px-2 py-1">No tasks</div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="pt-3 mt-3 border-t border-gray-200">
        <button
          onClick={() => window.open('#/tutorial', '_blank', 'noopener,noreferrer')}
          className="w-full text-left px-4 py-2 rounded-lg transition-colors text-gray-700 hover:bg-gray-100"
        >
          📘 Tutorial
        </button>
        <button
          onClick={openFeedbackModal}
          className="w-full text-left px-4 py-2 rounded-lg transition-colors text-gray-700 hover:bg-gray-100"
        >
          💬 Feedback
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
