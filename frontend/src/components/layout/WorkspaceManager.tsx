import React, { useState, useCallback } from 'react';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../hooks/useWorkspaceStatus';
import { WorkspaceInfo, WorkspaceNode } from '../../types';
import { Button } from '../ui/button';

const WorkspaceManager: React.FC = () => {
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Use improved hooks
  const { workspaces, currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const { isLoading, errors } = useWorkspaceStatus();
  const { setCurrentWorkspace, createWorkspace, deleteWorkspace, selectNode } = useWorkspaceActions();

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
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-foreground">Workspace Manager</h2>
          <Button
            onClick={() => setShowCreateForm(!showCreateForm)}
            disabled={isLoading.operations}
          >
            {showCreateForm ? 'Cancel' : 'New Workspace'}
          </Button>
        </div>

        {showCreateForm && (
          <div className="mb-4 rounded-md border border-border bg-muted/40 p-4">
            <input
              type="text"
              value={newWorkspaceName}
              onChange={(e) => setNewWorkspaceName(e.target.value)}
              placeholder="Enter workspace name"
              className="mb-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex gap-2">
              <Button
                onClick={handleCreateWorkspace}
                disabled={!newWorkspaceName.trim() || isLoading.operations}
                className="w-fit"
              >
                {isLoading.operations ? 'Creating...' : 'Create'}
              </Button>
              <Button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewWorkspaceName('');
                }}
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {errors.operations && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errors.operations}
          </div>
        )}

        {isLoading.workspaces && (
          <div className="mb-4 text-center text-muted-foreground">Loading workspaces...</div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Workspaces List */}
        <div>
          <h3 className="mb-3 text-lg font-medium text-foreground">Available Workspaces</h3>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {workspaces.map((workspace: WorkspaceInfo) => (
              <div
                key={workspace.workspace_id}
                className={`cursor-pointer rounded-md border p-3 transition-colors ${
                  workspace.workspace_id === currentWorkspaceId
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border hover:border-primary/40'
                }`}
                onClick={() => handleWorkspaceChange(workspace.workspace_id)}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-foreground">{workspace.name}</h4>
                    {workspace.description && (
                      <p className="text-sm text-muted-foreground">{workspace.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      ID: {workspace.workspace_id}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {workspace.workspace_id === currentWorkspaceId && (
                      <span className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
                        Active
                      </span>
                    )}
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteWorkspace(workspace.workspace_id);
                      }}
                      size="sm"
                      variant="destructive"
                      className="px-2 text-xs"
                      disabled={isLoading.operations}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Current Workspace Details */}
        <div>
          <h3 className="mb-3 text-lg font-medium text-foreground">
            {currentWorkspace ? `Workspace: ${currentWorkspace.name}` : 'No Workspace Selected'}
          </h3>
          
          {currentWorkspace && (
            <div>
              {isLoading.nodes && (
                <div className="mb-4 text-center text-muted-foreground">Loading nodes...</div>
              )}
              
              {errors.nodes && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  Error loading nodes: {errors.nodes}
                </div>
              )}

              <div className="max-h-64 space-y-2 overflow-y-auto">
                {nodes.map((node: WorkspaceNode) => (
                  <div
                    key={node.node_id}
                    className="cursor-pointer rounded-md border border-border p-2 transition-colors hover:bg-muted"
                    onClick={() => handleNodeSelect(node.node_id)}
                  >
                    <div className="font-medium text-foreground">{node.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Columns: {node.columns?.length || 0} | Rows: {node.shape?.[0] || 0}
                    </div>
                    <div className="text-xs text-muted-foreground">ID: {node.node_id}</div>
                  </div>
                ))}
                
                {nodes.length === 0 && !isLoading.nodes && (
                  <div className="py-4 text-center text-muted-foreground">
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
