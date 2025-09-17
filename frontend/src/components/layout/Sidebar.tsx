import React, { useEffect, useMemo, useState } from 'react';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useAuth } from '../../hooks/useAuth';
import { workspacesApi } from '../../api/workspaces';
import { useAnalysisStore } from '../../stores/analysisStore';
import { getApiBase } from '../../api/env';

interface SidebarProps {
  activeTab: 'data-loader' | 'filter' | 'token-frequency' | 'topic-modeling' | 'concordance' | 'analysis' | 'quotation' | 'export';
  onTabChange: (tab: 'data-loader' | 'filter' | 'token-frequency' | 'topic-modeling' | 'concordance' | 'analysis' | 'quotation' | 'export') => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  const { 
    workspaceGraph,
    selectedNodeIds,
    toggleNodeSelection,
    currentWorkspaceId,
  } = useWorkspace();
  const { getAuthHeaders } = useAuth();
  const { tasks, setTasks } = useAnalysisStore() as any;
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // Use workspaceGraph.nodes as the single source of truth for node count
  const nodeCount = workspaceGraph?.nodes?.length || 0;

  // Use SSE for real-time task updates (no polling fallback)
  useEffect(() => {
    if (!currentWorkspaceId) {
      setIsConnected(false);
      setConnectionError(null);
      return;
    }

    let cleanup = false;
    let abortController: AbortController | null = null;

    const connectSSE = async () => {
      if (cleanup) return;
      
      try {
        const authHeaders = getAuthHeaders();
        const baseUrl = getApiBase();
        const url = `${baseUrl}/workspaces/${currentWorkspaceId}/tasks/stream`;
        
        // Use fetch with proper auth headers for SSE
        abortController = new AbortController();
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache',
            ...authHeaders
          },
          credentials: 'include',
          signal: abortController.signal
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        if (!response.body) {
          throw new Error('Response body is null');
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        // Set connected state
        if (!cleanup) {
          setIsConnected(true);
          setConnectionError(null);
          console.log('SSE connected for task updates');
        }
        
        const processStream = async () => {
          let buffer = '';
          
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done || cleanup) {
                break;
              }
              
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;
              
              // Process complete SSE frames (ending with \n\n)
              const frames = buffer.split('\n\n');
              // Keep the last incomplete frame in buffer
              buffer = frames.pop() || '';
              
              for (const frame of frames) {
                if (!frame.trim()) continue;
                
                // Extract data from SSE frame (supports multiline data)
                const dataLines = frame.split('\n')
                  .filter(line => line.startsWith('data: '))
                  .map(line => line.slice(6)); // Remove 'data: ' prefix
                
                if (dataLines.length === 0) continue;
                
                const data = dataLines.join('\n'); // Rejoin multiline data
                if (!data.trim()) continue;
                
                try {
                  const parsedData = JSON.parse(data);
                  
                  if (parsedData.type === 'tasks_snapshot' && parsedData.tasks) {
                    // Initial snapshot of all tasks
                    setTasks(parsedData.tasks);
                  } else if (parsedData.type === 'task_changed' && parsedData.task) {
                    // Single task updated - merge into existing tasks
                    setTasks((prevTasks: any[]) => {
                      const otherTasks = prevTasks.filter(t => t.task_id !== parsedData.task.task_id);
                      return [...otherTasks, parsedData.task].sort((a, b) => {
                        const tb = (b.finished_at || b.started_at || b.created_at || 0);
                        const ta = (a.finished_at || a.started_at || a.created_at || 0);
                        return tb - ta;
                      });
                    });
                    
                    // Bridge: If task is topic_modeling, successful, and result_persisted, dispatch result ready event
                    if (parsedData.task?.task_type === 'topic_modeling' && 
                        parsedData.task?.status === 'successful' && 
                        parsedData.result_persisted === true) {
                      window.dispatchEvent(new CustomEvent('topicModelingResultReady', {
                        detail: {
                          task_id: parsedData.task.task_id,
                          task_type: parsedData.task.task_type,
                          timestamp: parsedData.timestamp
                        }
                      }));
                    }
                  } else if (parsedData.type === 'analysis_saved' && parsedData.task_type === 'topic_modeling') {
                    // Topic modeling result is ready - dispatch custom event
                    window.dispatchEvent(new CustomEvent('topicModelingResultReady', {
                      detail: {
                        task_id: parsedData.task_id,
                        task_type: parsedData.task_type,
                        timestamp: parsedData.timestamp
                      }
                    }));
                  } else if (parsedData.type === 'analysis_save_failed' && parsedData.task_type === 'topic_modeling') {
                    // Analysis save failed - show error
                    console.error('Topic modeling result save failed:', parsedData.message);
                    setConnectionError(`Save failed: ${parsedData.message}`);
                  } else if (parsedData.type === 'task_update' && parsedData.tasks) {
                    // Legacy task_update format for backward compatibility
                    setTasks(parsedData.tasks);
                  } else if (parsedData.type === 'error') {
                    console.error('SSE error:', parsedData.message);
                    setConnectionError(parsedData.message);
                  } else if (parsedData.type === 'heartbeat') {
                    // Heartbeat - just keep connection alive, no action needed
                  }
                } catch (e) {
                  console.warn('Failed to parse SSE message:', data, e);
                }
              }
            }
          } catch (error) {
            if (!cleanup) {
              console.warn('Stream processing error:', error);
              setIsConnected(false);
              setConnectionError('Stream processing error');
            }
          } finally {
            reader.releaseLock();
          }
        };
        
        // Process the stream with error handling
        try {
          await processStream();
        } catch (streamError) {
          if (!cleanup) {
            console.warn('Stream processing failed:', streamError);
            setIsConnected(false);
            setConnectionError('Stream processing error');
            
            // Auto-reconnect SSE after a delay
            setTimeout(() => {
              if (!cleanup) {
                connectSSE();
              }
            }, 5000);
          }
        }
        
      } catch (error) {
        if (!cleanup) {
          console.error('Failed to create SSE connection:', error);
          setIsConnected(false);
          setConnectionError('Connection error');
          
          // Auto-reconnect SSE after a delay
          setTimeout(() => {
            if (!cleanup) {
              connectSSE();
            }
          }, 10000);
        }
      }
    };

    connectSSE();

    return () => {
      cleanup = true;
      if (abortController) {
        abortController.abort();
      }
      setIsConnected(false);
      setConnectionError(null);
    };
  }, [currentWorkspaceId, getAuthHeaders, setTasks]);

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
          onClick={() => onTabChange('quotation')}
          className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
            activeTab === 'quotation'
              ? 'bg-blue-100 text-blue-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          ❝ Quotation
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

      {/* Tasks list */}
      <div className="mt-4 pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700">Tasks</h4>
          <div className="flex items-center gap-2">
            {connectionError ? (
              <span className="text-xs text-red-500" title={connectionError}>❌</span>
            ) : isConnected ? (
              <span className="text-xs text-green-500" title="Real-time updates active (SSE)">🟢</span>
            ) : (
              <span className="text-xs text-yellow-500" title="Connecting...">🟡</span>
            )}
          </div>
        </div>
        <div className="space-y-1">
          {Array.isArray(tasks) && tasks.length > 0 ? tasks.slice().sort((a:any,b:any)=>{
            const kb = (b.finished_at||b.started_at||b.created_at||0);
            const ka = (a.finished_at||a.started_at||a.created_at||0);
            return kb - ka;
          }).map((t:any)=>{
            const status = t.status as string;
            const icon = status === 'running' ? '⏳' : status === 'successful' ? '✅' : status === 'failed' ? '❌' : '⏹️';
            const color = status === 'running' ? 'text-amber-600' : status === 'successful' ? 'text-green-600' : status === 'failed' ? 'text-red-600' : 'text-gray-600';
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
                                  ? { ...task, status: 'cancelled' } 
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
          onClick={() => window.dispatchEvent(new CustomEvent('openFeedback'))}
          className="w-full text-left px-4 py-2 rounded-lg transition-colors text-gray-700 hover:bg-gray-100"
        >
          💬 Feedback
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
