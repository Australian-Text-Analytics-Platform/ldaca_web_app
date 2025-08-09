import React, { memo, useEffect, useState } from 'react';
import { useWorkspace } from '../hooks/useWorkspace';

/**
 * Separated controls component focused only on workspace controls
 * Removed view mode toggle since both views are now shown vertically
 */
export const WorkspaceControls: React.FC = memo(() => {
  const { 
    currentWorkspace,
    workspaceGraph,
  selectedNodeIds,
  saveWorkspace,
  saveWorkspaceAs,
  renameWorkspace,
  } = useWorkspace();

  // Use workspaceGraph.nodes as the single source of truth for node count
  const nodeCount = workspaceGraph?.nodes?.length || 0;

  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(currentWorkspace?.name || '');

  useEffect(() => {
    setNameInput(currentWorkspace?.name || '');
  }, [currentWorkspace?.name]);

  const handleRenameCommit = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === currentWorkspace?.name) {
      setIsEditing(false);
      return;
    }
    try {
      await renameWorkspace(trimmed);
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex flex-col gap-1">
        {/* Workspace info + actions (first line) */}
        <div className="flex items-center gap-3 flex-wrap">
          {isEditing ? (
            <input
              className="px-2 py-1 border rounded text-sm"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleRenameCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameCommit();
                if (e.key === 'Escape') setIsEditing(false);
              }}
              autoFocus
              aria-label="Workspace name"
            />
          ) : (
            <h2 className="text-lg font-semibold text-gray-800">
              {currentWorkspace?.name || 'No Workspace'}
            </h2>
          )}

          {/* Edit name button with pencil icon */}
          <button
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={() => setIsEditing((v) => !v)}
            title="Edit name"
            aria-label="Edit workspace name"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M16.862 3.487a1.5 1.5 0 0 1 2.121 0l1.53 1.53a1.5 1.5 0 0 1 0 2.122l-9.9 9.9a1.5 1.5 0 0 1-.53.352l-4.18 1.393a.75.75 0 0 1-.948-.948l1.392-4.18a1.5 1.5 0 0 1 .352-.53l9.9-9.9Z" />
              <path d="M18.26 2.08a3 3 0 0 1 4.243 0l.53.53a3 3 0 0 1 0 4.243l-1.06 1.06-4.773-4.773 1.06-1.06Z" />
            </svg>
            Edit
          </button>

          {/* Save */}
          <button
            className="text-sm text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={() => saveWorkspace()}
            title="Save workspace"
          >
            Save
          </button>

          {/* Save As */}
          <button
            className="text-sm text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={async () => {
              const filename = window.prompt('Save workspace as (filename):', currentWorkspace?.name || 'workspace.ldaca');
              if (filename) {
                await saveWorkspaceAs(filename);
              }
            }}
            title="Save workspace as"
          >
            Save As
          </button>
        </div>

  {/* Nodes/selection summary (second line) */}
  <div className="text-sm text-gray-600">{nodeCount} nodes • {selectedNodeIds.length} selected</div>
      </div>
    </div>
  );
});

WorkspaceControls.displayName = 'WorkspaceControls';
