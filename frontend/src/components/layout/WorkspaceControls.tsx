import React, { useState } from 'react';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceSelection } from '@/features/workspace/common/hooks/useWorkspaceSelection';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { getInvalidWorkspaceNameMessage } from '@/features/workspace/common/workspaceName';
import HelpIcon from '@/components/help/HelpIcon';

const MIN_BATCH_DELETE_COUNT = 3;

/**
 * Separated controls component focused only on workspace controls
 * Removed view mode toggle since both views are now shown vertically
 */
export const WorkspaceControls: React.FC = () => {
  const { currentWorkspace, workspaceGraph } = useWorkspaceData();
  const { renameWorkspace, deleteNode, clearSelection } = useWorkspaceActions();
  const { selectedNodeIds } = useWorkspaceSelection();

  const [renameDraft, setRenameDraft] = useState<{ baseName: string; value: string }>();
  const [nameAlertOpen, setNameAlertOpen] = useState(false);
  const [nameAlertMessage, setNameAlertMessage] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const currentWorkspaceName = currentWorkspace?.name || '';
  const isEditing = renameDraft?.baseName === currentWorkspaceName;

  const selectedCount = selectedNodeIds?.length ?? 0;
  const canBatchDelete = selectedCount >= MIN_BATCH_DELETE_COUNT;

  const selectedForDelete = (() => {
    if (!workspaceGraph || !selectedNodeIds || selectedNodeIds.length === 0) return [];
    const idSet = new Set(selectedNodeIds);
    const incomingTargets = new Set(workspaceGraph.edges.map((edge) => edge.target));
    const items = workspaceGraph.nodes
      .filter((node) => idSet.has(node.id))
      .map((node) => ({
        id: node.id,
        name: typeof node.name === 'string' && node.name.trim() ? node.name : node.id,
        isRoot: !incomingTargets.has(node.id),
      }));
    return items.sort((a, b) => {
      if (a.isRoot !== b.isRoot) return a.isRoot ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  })();

  const handleBatchDelete = async () => {
    if (!canBatchDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      // Settled, not all: if the backend cascades on parent removal, a
      // later child deletion may 404 — that's still the outcome the
      // user asked for, so don't abort the rest of the batch.
      await Promise.allSettled(
        selectedForDelete.map((item) => deleteNode(item.id)),
      );
      clearSelection?.();
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRenameCommit = async () => {
    if (!isEditing) {
      return;
    }
    const trimmed = renameDraft.value.trim();
    if (!trimmed || trimmed === currentWorkspaceName) {
      setRenameDraft(undefined);
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
      setRenameDraft(undefined);
    }
  };

  const startRename = () => {
    if (!currentWorkspaceName) {
      return;
    }
    setRenameDraft({ baseName: currentWorkspaceName, value: currentWorkspaceName });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <h3 className="text-sm font-medium text-gray-700">Workspace Graph View</h3>
      <HelpIcon targetKey="ui.workspace-graph-view" label="Workspace Graph View" className="h-5 w-5 text-muted-foreground" />
      <span className="text-gray-300">|</span>
      
      {isEditing ? (
        <input
          className="px-2 py-1 border rounded text-sm"
          value={renameDraft.value}
          onChange={(e) => setRenameDraft({ baseName: currentWorkspaceName, value: e.target.value })}
          onBlur={handleRenameCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameCommit();
            if (e.key === 'Escape') setRenameDraft(undefined);
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
            onClick={startRename}
            title="Rename"
            aria-label="Rename workspace"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3">
              <path d="M16.862 3.487a1.5 1.5 0 0 1 2.121 0l1.53 1.53a1.5 1.5 0 0 1 0 2.122l-9.9 9.9a1.5 1.5 0 0 1-.53.352l-4.18 1.393a.75.75 0 0 1-.948-.948l1.392-4.18a1.5 1.5 0 0 1 .352-.53l9.9-9.9Z" />
              <path d="M18.26 2.08a3 3 0 0 1 4.243 0l.53.53a3 3 0 0 1 0 4.243l-1.06 1.06-4.773-4.773 1.06-1.06Z" />
            </svg>
            Rename
          </button>

          {/* Batch delete — only enabled with 3+ selected so this stays
              a deliberate, batch-only action. Per-node delete is still
              available from each node's context menu in the graph.
              Same size + shape in both states so the layout stays
              stable; only colours swap — destructive (red) when
              actionable, the existing muted/bordered look when not. */}
          <button
            className={`text-xs px-2 py-1 border rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              canBatchDelete && !isDeleting
                ? 'bg-destructive text-destructive-foreground border-destructive shadow-sm hover:bg-destructive/90 hover:border-destructive/90'
                : 'text-gray-600 hover:text-gray-800'
            }`}
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={!canBatchDelete || isDeleting}
            title={
              canBatchDelete
                ? 'Delete the selected data blocks'
                : `Select ${MIN_BATCH_DELETE_COUNT} or more data blocks to batch-delete`
            }
          >
            Delete ({selectedCount})
          </button>
        </>
      )}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedForDelete.length} data block{selectedForDelete.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The following data blocks will be removed
              (root blocks — those with no parent — are bolded; deleting a
              root cascades to any downstream blocks too):
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto rounded border bg-muted/40 p-2 text-sm">
            {selectedForDelete.map((item) => (
              <li
                key={item.id}
                className={item.isRoot ? 'font-semibold' : undefined}
              >
                {item.name}
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button asChild variant="destructive" disabled={isDeleting}>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleBatchDelete();
                }}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : `Delete ${selectedForDelete.length}`}
              </AlertDialogAction>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
};
