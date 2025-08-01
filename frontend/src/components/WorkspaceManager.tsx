import React, { useState, useCallback } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';
import { WorkspaceInfo, WorkspaceNode } from '../types';

const WorkspaceManager: React.FC = () => {
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Use improved hooks
  const { 
    workspaces, 
    currentWorkspaceId, 
    workspaceGraph,
    setCurrentWorkspace,
    createWorkspace,
    deleteWorkspace,
    selectNode,
    isLoading,
    errors
  } = useWorkspace();

  // Extract nodes from the unified graph data source
  const nodes = workspaceGraph?.nodes || [];

  // Handlers
  const handleWorkspaceChange = useCallback((workspaceId: string | null) => {
    setCurrentWorkspace(workspaceId);
  }, [setCurrentWorkspace]);

  const handleCreateWorkspace = useCallback(async () => {
    if (newWorkspaceName.trim()) {
      try {
        await createWorkspace(newWorkspaceName.trim());
        setNewWorkspaceName('');
        setShowCreateForm(false);
      } catch (error) {
        console.error('Failed to create workspace:', error);
      }
    }
  }, [createWorkspace, newWorkspaceName]);

  const handleDeleteWorkspace = useCallback(async (workspaceId: string) => {
    if (window.confirm('Are you sure you want to delete this workspace?')) {
      try {
        await deleteWorkspace(workspaceId);
      } catch (error) {
        console.error('Failed to delete workspace:', error);
      }
    }
  }, [deleteWorkspace]);

  const handleNodeSelect = useCallback((nodeId: string) => {
    selectNode(nodeId);
  }, [selectNode]);

  const currentWorkspace = workspaces.find((w: WorkspaceInfo) => w.workspace_id === currentWorkspaceId);

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800">Workspace Manager</h2>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
            disabled={isLoading.operations}
          >
            {showCreateForm ? 'Cancel' : 'New Workspace'}
          </button>
        </div>

        {showCreateForm && (
          <div className="mb-4 p-4 bg-gray-50 rounded-md">
            <input
              type="text"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="Enter workspace name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateWorkspace}
                disabled={!newWorkspaceName.trim() || isLoading.operations}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors disabled:bg-gray-400"
              >
                {isLoading.operations ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewWorkspaceName('');
                }}
                className="px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {errors.operations && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {errors.operations}
          </div>
        )}

        {isLoading.workspaces && (
          <div className="mb-4 text-center text-gray-600">Loading workspaces...</div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Workspaces List */}
        <div>
          <h3 className="text-lg font-medium text-gray-700 mb-3">Available Workspaces</h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {workspaces.map((workspace: WorkspaceInfo) => (
              <div
                key={workspace.workspace_id}
                className={`p-3 border rounded-md cursor-pointer transition-colors ${
                  workspace.workspace_id === currentWorkspaceId
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
                onClick={() => handleWorkspaceChange(workspace.workspace_id)}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-gray-800">{workspace.name}</h4>
                    {workspace.description && (
                      <p className="text-sm text-gray-600">{workspace.description}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      ID: {workspace.workspace_id}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {workspace.workspace_id === currentWorkspaceId && (
                      <span className="px-2 py-1 text-xs bg-blue-500 text-white rounded">
                        Active
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteWorkspace(workspace.workspace_id);
                      }}
                      className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                      disabled={isLoading.operations}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Current Workspace Details */}
        <div>
          <h3 className="text-lg font-medium text-gray-700 mb-3">
            {currentWorkspace ? `Workspace: ${currentWorkspace.name}` : 'No Workspace Selected'}
          </h3>
          
          {currentWorkspace && (
            <div>
              {isLoading.nodes && (
                <div className="text-center text-gray-600 mb-4">Loading nodes...</div>
              )}
              
              {errors.nodes && (
                <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                  Error loading nodes: {errors.nodes}
                </div>
              )}

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {nodes.map((node: WorkspaceNode) => (
                  <div
                    key={node.node_id}
                    className="p-2 border border-gray-300 rounded cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => handleNodeSelect(node.node_id)}
                  >
                    <div className="font-medium text-gray-800">{node.name}</div>
                    <div className="text-sm text-gray-600">
                      Columns: {node.columns?.length || 0} | Rows: {node.shape?.[0] || 0}
                    </div>
                    <div className="text-xs text-gray-500">ID: {node.node_id}</div>
                  </div>
                ))}
                
                {nodes.length === 0 && !isLoading.nodes && (
                  <div className="text-center text-gray-500 py-4">
                    No nodes in this workspace
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkspaceManager;
