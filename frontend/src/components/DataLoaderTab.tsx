import React, { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import SegmentedControl from './SegmentedControl';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { downloadWorkspace, downloadFile as apiDownloadFile, importWorkspace } from '../api';
import { queryKeys } from '../lib/queryKeys';
import { useFiles } from '../hooks/useFiles';
import FilePreviewModal from './FilePreviewModal';
import AddFileModal from './AddFileModal';

const DataLoaderTab: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const queryClient = useQueryClient();
  const { 
    currentWorkspace,
    workspaces,
    isLoading,
    errors,
    createWorkspace,
    setCurrentWorkspace,
  createNodeFromFile,
  deleteWorkspace,
  saveWorkspace
  } = useWorkspace();

  // Create stable auth headers object
  const authHeaders = useMemo(() => {
    return getAuthHeaders();
  }, [getAuthHeaders]);  const { 
    files, 
    uploading, 
    handleUploadFile
  , handleDeleteFile, refetchFiles } = useFiles({ authHeaders });

  const [activeLoader, setActiveLoader] = useState<'file' | 'workspace' | 'filter'>('file');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [addingToWorkspace, setAddingToWorkspace] = useState<string | null>(null);
  const [fileToAdd, setFileToAdd] = useState<string | null>(null);
  const downloadFile = useCallback(async (filename: string) => {
    try {
      // Route through backend API (proxy-aware) instead of relative /api path
      const blob = await apiDownloadFile(filename, authHeaders);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.split('/').pop() || filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
    } catch (e) {
      console.error(e);
      alert('Failed to download file');
    }
  }, [authHeaders]);

  // File upload only (workspace linking is a separate explicit action)
  const handleFileInputUpload = useCallback(async (files: FileList) => {
    if (!files.length) return;
    try {
      for (const file of Array.from(files)) {
        await handleUploadFile(file);
      }
    } catch (error) {
      console.error('Failed to upload files:', error);
    }
  }, [handleUploadFile]);

  // Add file to existing workspace only (workspace must be created beforehand)
  const handleConfirmedAdd = useCallback(async (filename: string, mode: 'DocLazyFrame' | 'LazyFrame', documentColumn?: string | null) => {
    if (!currentWorkspace) {
      console.warn('Attempted to add node without an active workspace.');
      return;
    }
    setAddingToWorkspace(filename);
    try {
      await createNodeFromFile(filename, { mode, documentColumn });
    } catch (e) {
      console.error('Failed to add file:', e);
    } finally {
      setAddingToWorkspace(null);
    }
  }, [currentWorkspace, createNodeFromFile]);

  // Load workspace
  const handleLoadWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await setCurrentWorkspace(workspaceId);
  if (localStorage.getItem('debugApp') === '1') console.log('Workspace loaded successfully');
    } catch (error) {
      console.error('Failed to load workspace:', error);
    }
  }, [setCurrentWorkspace]);

  // Delete workspace
  const handleDeleteWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await deleteWorkspace(workspaceId);
  if (localStorage.getItem('debugApp') === '1') console.log('Workspace deleted successfully');
    } catch (error) {
      console.error('Failed to delete workspace:', error);
    }
  }, [deleteWorkspace]);

  // Unload current workspace
  const handleUnloadWorkspace = useCallback(() => {
    setCurrentWorkspace(null);
  if (localStorage.getItem('debugApp') === '1') console.log('Workspace unloaded');
  }, [setCurrentWorkspace]);

  // Standalone global DnD removed; list handles DnD directly

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Data Loader</h2>
        
        {/* Loader Type Selector */}
        <div className="mb-6">
          <SegmentedControl
            options={[
              { value: 'file', label: 'File Upload' },
              { value: 'workspace', label: 'Workspace Manager' }
            ]}
            value={activeLoader}
            onChange={(val: string)=> setActiveLoader(val as 'file'|'workspace')}
            ariaLabel="Data loader mode"
          />
        </div>

        {/* File Upload Tab */}
        {activeLoader === 'file' && (
          <div className="space-y-4">
            {!currentWorkspace && (
              <div className="flex space-x-4 mb-4">
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder="Workspace name (optional)"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}
            
            {/* Standalone drop-zone removed; users can drop directly onto the list below */}
            <div className="flex items-center justify-between text-sm text-gray-600">
              <div>
                Drag & drop files onto the list below to upload, or
                <label className="text-blue-600 hover:text-blue-700 cursor-pointer ml-1">
                  browse
                  <input
                    type="file"
                    multiple
                    onChange={(e) => e.target.files && handleFileInputUpload(e.target.files)}
                    className="hidden"
                    accept=".csv,.json,.txt,.tsv,.parquet"
                  />
                </label>
              </div>
              {uploading && (
                <span className="text-blue-600">Uploading…</span>
              )}
            </div>
            
            {uploading && (
              <div className="text-center py-4">
                <div className="inline-flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                  <span className="text-sm text-gray-600">Uploading...</span>
                </div>
              </div>
            )}

            {/* Available Files for Adding to Workspace */}
            {files.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-700">Available Files</h3>
                </div>
                <div
                  className="space-y-2 max-h-[28rem] overflow-y-auto border border-gray-200 rounded-md p-1"
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dropped = e.dataTransfer?.files;
                    if (dropped && dropped.length) {
                      for (const f of Array.from(dropped)) {
                        await handleUploadFile(f);
                      }
                    }
                  }}
                >
                  {files.map((file) => (
                    <div
                      key={file.filename}
                      className="flex items-center justify-between p-2 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer"
                      onClick={() => setPreviewFile(file.filename)}
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{file.full_path || file.filename}</p>
                        {(file.folder || file.display_name) && (
                          <p className="text-[11px] text-gray-400 truncate">
                            {file.folder ? `${file.folder}/` : ''}{file.display_name || ''}
                          </p>
                        )}
                        <p className="text-xs text-gray-500">
                          {(file.size / 1024).toFixed(1)} KB • {file.file_type}
                          {typeof file.is_sample !== 'undefined' && (
                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold ${file.is_sample ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {file.is_sample ? 'SAMPLE' : 'USER'}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!currentWorkspace) {
                              try {
                                const workspaceName = newWorkspaceName.trim() || `Workspace ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`;
                                const ws = await createWorkspace(workspaceName, 'Auto-created');
                                await setCurrentWorkspace(ws.workspace_id);
                                setNewWorkspaceName('');
                                // Open modal AFTER workspace creation so user can pick column/type then explicitly add
                                setFileToAdd(file.filename);
                              } catch (err) {
                                console.error('Workspace creation failed:', err);
                              }
                            } else {
                              setFileToAdd(file.filename);
                            }
                          }}
                          disabled={addingToWorkspace === file.filename || isLoading.operations}
                          className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {addingToWorkspace === file.filename
                            ? 'Adding...'
                            : currentWorkspace
                              ? 'Add to Workspace'
                              : 'Create Workspace'}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadFile(file.filename); }}
                          className="px-2 py-1 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                          title="Download file"
                        >
                          Download
                        </button>
                        {!file.is_sample && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const confirm = window.confirm(`Delete file "${file.filename}"? This cannot be undone.`);
                              if (!confirm) return;
                              const ok = await handleDeleteFile(file.filename);
                              if (!ok) {
                                console.error('Failed to delete file');
                              } else {
                                // Refresh list to reflect deletion
                                refetchFiles();
                              }
                            }}
                            className="px-2 py-1 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100"
                            title="Delete file"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <FilePreviewModal
                  filename={previewFile}
                  isOpen={!!previewFile}
                  onClose={() => setPreviewFile(null)}
                />
                <AddFileModal
                  filename={fileToAdd}
                  isOpen={!!fileToAdd}
                  onClose={() => setFileToAdd(null)}
                  onConfirm={async ({ mode, documentColumn }) => {
                    if (!fileToAdd) return;
                    await handleConfirmedAdd(fileToAdd, mode, documentColumn);
                    setFileToAdd(null);
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Workspace Manager Tab */}
        {activeLoader === 'workspace' && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-700">Available Workspaces</h3>
            {/* Workspace upload (import) */}
            <div className="flex items-center justify-between text-sm text-gray-600">
              <div>
                Drag & drop files onto the list below to upload, or
                <label className="text-blue-600 hover:text-blue-700 cursor-pointer ml-1">
                  browse
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        await importWorkspace(f, authHeaders);
                        // refresh workspaces list
                        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
                      } catch (err) {
                        console.error('Failed to import workspace:', err);
                        alert('Failed to import workspace');
                      } finally {
                        // Invalidate workspace list via useWorkspace hook
                        // We don't have direct access to query client here; rely on backend consistency
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            {isLoading.workspaces ? (
              <p>Loading workspaces...</p>
            ) : (
              <div
                className="space-y-2 max-h-[28rem] overflow-y-auto border border-gray-200 rounded-md p-1"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={async (e) => {
                  e.preventDefault(); e.stopPropagation();
                  const files = Array.from(e.dataTransfer.files || []);
                  for (const f of files) {
                    if (!f.name.toLowerCase().endsWith('.json')) continue;
                    try {
                      await importWorkspace(f, authHeaders);
                      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
                    } catch (err) {
                      console.error('Failed to import workspace:', err);
                    }
                  }
                }}
              >
                {workspaces.length === 0 && (
                  <div className="p-2 text-gray-500 text-sm">No workspaces available.</div>
                )}
                {workspaces.map((workspace: any) => (
                  <div
                    key={workspace.workspace_id}
                    className="flex items-center justify-between p-2 border border-gray-200 rounded hover:bg-gray-50"
                  >
                    <div className="flex items-center">
                      <span className="mr-3 text-lg" title={workspace.is_saved ? 'Saved' : 'Not Saved'}>
                        {workspace.is_saved ? '💾' : '📝'}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-800">{workspace.name}</p>
                        <p className="text-xs text-gray-500">
                          {typeof workspace.node_count !== 'undefined' ? `${workspace.node_count} nodes` : ''}
                          {typeof workspace.file_size !== 'undefined' && (
                            <span className="ml-2">• {(workspace.file_size / 1024).toFixed(1)} KB</span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          {workspace.created_at ? `Created: ${new Date(workspace.created_at).toLocaleString()}` : ''}
                          {workspace.modified_at && (
                            <span className="ml-2">Updated: {new Date(workspace.modified_at).toLocaleString()}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleLoadWorkspace(workspace.workspace_id)}
                        className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={currentWorkspace?.workspace_id === workspace.workspace_id}
                      >
                        {currentWorkspace?.workspace_id === workspace.workspace_id ? 'Loaded' : 'Load'}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            if (currentWorkspace?.workspace_id === workspace.workspace_id && !workspace.is_saved) {
                              await saveWorkspace();
                            }
                            const blob = await downloadWorkspace(workspace.workspace_id, authHeaders);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            const fname = `${workspace.name || 'workspace'}_${workspace.workspace_id}.json`;
                            a.href = url;
                            a.download = fname.replace(/\s+/g, '_');
                            document.body.appendChild(a);
                            a.click();
                            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
                          } catch (e) {
                            console.error('Failed to download workspace', e);
                            alert('Workspace download failed');
                          }
                        }}
                        className="px-2 py-1 text-sm bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                        title="Download workspace JSON"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => handleDeleteWorkspace(workspace.workspace_id)}
                        className="px-2 py-1 text-sm bg-red-50 text-red-600 rounded hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {currentWorkspace && (
              <div className="mt-4 pt-4 border-t">
                <button
                  onClick={handleUnloadWorkspace}
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-gray-600 rounded-md hover:bg-gray-700"
                >
                  Unload Current Workspace
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading States */}
        {isLoading.operations && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 flex items-center space-x-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <span className="text-gray-700">Processing...</span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {errors.operations && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">Error: {errors.operations}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataLoaderTab;
