import React, { memo, useEffect, useState } from 'react';
import { useWorkspaceData } from '../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../hooks/useWorkspaceActions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { getInvalidWorkspaceNameMessage } from '../../lib/workspaceName';

/**
 * Separated controls component focused only on workspace controls
 * Removed view mode toggle since both views are now shown vertically
 */
export const WorkspaceControls: React.FC = memo(() => {
  const { currentWorkspace } = useWorkspaceData();
  const { saveWorkspace, saveWorkspaceAs, renameWorkspace, setCurrentWorkspace } = useWorkspaceActions();

  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState(currentWorkspace?.name || '');
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [nameAlertOpen, setNameAlertOpen] = useState(false);
  const [nameAlertMessage, setNameAlertMessage] = useState('');

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
    } catch (error) {
      const message = getInvalidWorkspaceNameMessage(error);
      if (message) {
        setNameAlertMessage(message);
        setNameAlertOpen(true);
      }
    } finally {
      setIsEditing(false);
    }
  };

  const handleSaveAs = async () => {
    if (saveAsName) {
      await saveWorkspaceAs(saveAsName);
      setSaveAsOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <h3 className="text-sm font-medium text-gray-700">Workspace Graph View</h3>
      <span className="text-gray-300">|</span>
      
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
        <span className="text-sm font-semibold text-gray-800">
          {currentWorkspace?.name || 'No Workspace'}
        </span>
      )}

      {currentWorkspace && (
        <>
          {/* Edit name button with pencil icon */}
          <button
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={() => setIsEditing((v) => !v)}
            title="Rename"
            aria-label="Rename workspace"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
              <path d="M16.862 3.487a1.5 1.5 0 0 1 2.121 0l1.53 1.53a1.5 1.5 0 0 1 0 2.122l-9.9 9.9a1.5 1.5 0 0 1-.53.352l-4.18 1.393a.75.75 0 0 1-.948-.948l1.392-4.18a1.5 1.5 0 0 1 .352-.53l9.9-9.9Z" />
              <path d="M18.26 2.08a3 3 0 0 1 4.243 0l.53.53a3 3 0 0 1 0 4.243l-1.06 1.06-4.773-4.773 1.06-1.06Z" />
            </svg>
            Rename
          </button>

          {/* Save */}
          <button
            className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={() => saveWorkspace()}
            title="Save workspace"
          >
            Save
          </button>

          {/* Save As */}
          <button
            className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={() => {
              setSaveAsName(currentWorkspace?.name || 'workspace.ldaca');
              setSaveAsOpen(true);
            }}
            title="Save workspace as"
          >
            Save As
          </button>

          {/* Unload */}
          <button
            className="text-xs text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={() => setCurrentWorkspace(null)}
            title="Unload workspace (remove from memory)"
          >
            Unload
          </button>
        </>
      )}

      <Dialog open={saveAsOpen} onOpenChange={setSaveAsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Workspace As</DialogTitle>
            <DialogDescription>
              Enter a new filename for the workspace copy.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              placeholder="Filename"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveAs();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAs}>Save As</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={nameAlertOpen} onOpenChange={setNameAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid workspace name</AlertDialogTitle>
            <AlertDialogDescription>
              {nameAlertMessage || 'Workspace names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setNameAlertOpen(false)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

WorkspaceControls.displayName = 'WorkspaceControls';
