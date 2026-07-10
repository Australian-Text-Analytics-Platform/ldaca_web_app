import { useState } from 'react';
import { PanelRightClose, Pencil } from 'lucide-react';
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

/** Minimum selection size for the graph delete affordance to be actionable. */
const MIN_BATCH_DELETE_COUNT = 1;

/**
 * Workspace graph toolbar used above the graph pane. It centralizes workspace
 * rename, help, and batch-delete controls so the graph feature can focus on
 * node rendering and selection state.
 * Rendered by: WorkspaceView above the graph canvas.
 * Flow: read workspace and selection state, prepare selected-delete metadata, manage rename/delete dialogs, then render toolbar controls.
 *
 * ``onToggleCollapse`` renders the collapse button. The collapsed shell
 * returns before mounting this toolbar, so controls only model the live graph
 * view and carry no unreachable compact-mode branch.
 */
export function WorkspaceControls({ onToggleCollapse }: { onToggleCollapse?: () => void } = {}) {
  const { currentWorkspace, workspaceGraph } = useWorkspaceData();
  const { renameWorkspace, deleteNode, clearSelection } = useWorkspaceActions();
  const { selectedNodeIds } = useWorkspaceSelection();

  const [renameDraft, setRenameDraft] = useState<{ baseName: string; value: string }>();
  const [nameAlertOpen, setNameAlertOpen] = useState(false);
  const [nameAlertMessage, setNameAlertMessage] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const currentWorkspaceName = currentWorkspace?.name ?? '';
  const isEditing = renameDraft?.baseName === currentWorkspaceName;

  const selectedCount = selectedNodeIds.length;
  const canBatchDelete = selectedCount >= MIN_BATCH_DELETE_COUNT;

  /** Builds the confirmation list for the selected graph nodes, sorted by name. */
  const selectedForDelete = (() => {
    if (!workspaceGraph || selectedNodeIds.length === 0) return [];
    const idSet = new Set(selectedNodeIds);
    return workspaceGraph.nodes
      .filter((node) => idSet.has(node.id))
      .map((node) => ({
        id: node.id,
        name: typeof node.name === 'string' && node.name.trim() ? node.name : node.id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  })();

  /** Called by: the WorkspaceControls batch-delete confirmation action. */
  const handleBatchDelete = async () => {
    if (!canBatchDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      // Each node carries its own independent lazy plan, so deletions
      // don't cascade. Settle rather than all-or-nothing so one failure
      // doesn't abort the rest of the batch.
      await Promise.allSettled(selectedForDelete.map((item) => deleteNode(item.id)));
      clearSelection();
      setDeleteConfirmOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  /** Called by: WorkspaceControls inline rename input blur and keyboard handlers. */
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

  /** Called by: the WorkspaceControls Rename button onClick prop because the interaction needs a single handler that validates state, runs the action, and updates feedback. */
  const startRename = () => {
    if (!currentWorkspaceName) {
      return;
    }
    setRenameDraft({ baseName: currentWorkspaceName, value: currentWorkspaceName });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white/80 text-gray-700 shadow-sm hover:bg-gray-50"
          aria-label="Collapse workspace panel"
          title="Collapse"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      )}
      <h3 className="text-sm font-medium text-gray-700">Workspace Graph View</h3>
      <HelpIcon
        targetKey="ui.workspace-graph-view"
        label="Workspace Graph View"
        className="h-5 w-5 text-muted-foreground"
      />
      <span className="text-gray-300">|</span>

      {isEditing ? (
        <input
          className="px-2 py-1 border rounded text-sm"
          value={renameDraft.value}
          onChange={(e) => {
            setRenameDraft({ baseName: currentWorkspaceName, value: e.target.value });
          }}
          onBlur={() => {
            void handleRenameCommit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleRenameCommit();
            if (e.key === 'Escape') setRenameDraft(undefined);
          }}
          autoFocus
          aria-label="Workspace name"
        />
      ) : (
        <span className="text-sm font-semibold text-gray-800">
          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- show placeholder for an empty name, not only null/undefined */}
          {currentWorkspace?.name || 'No Workspace'}
        </span>
      )}

      {currentWorkspace && (
        <>
          <button
            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
            onClick={startRename}
            title="Rename"
            aria-label="Rename workspace"
          >
            <Pencil className="h-3 w-3" />
            Rename
          </button>

          {/* Delete — always enabled so there are no surprises about why
              it's greyed out. The confirmation dialog gates the actual
              removal, and the disabled state only kicks in mid-delete.
              Per-node delete is still available from each node's context
              menu in the graph. Same size + shape in both states so the
              layout stays stable; only colours swap — destructive (red)
              when actionable, the existing muted/bordered look when not. */}
          <button
            className={`text-xs px-2 py-1 border rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              canBatchDelete && !isDeleting
                ? 'bg-destructive text-destructive-foreground border-destructive shadow-sm hover:bg-destructive/90 hover:border-destructive/90'
                : 'text-gray-600 hover:text-gray-800'
            }`}
            onClick={() => {
              setDeleteConfirmOpen(true);
            }}
            disabled={isDeleting}
            title="Delete the selected data blocks"
          >
            Delete ({selectedCount})
          </button>
        </>
      )}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedForDelete.length} data block
              {selectedForDelete.length === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The following data blocks will be removed:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-60 overflow-y-auto rounded border bg-muted/40 p-2 text-sm">
            {selectedForDelete.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button asChild variant="destructive" disabled={isDeleting || !canBatchDelete}>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleBatchDelete();
                }}
                disabled={isDeleting || !canBatchDelete}
              >
                {isDeleting ? 'Deleting…' : `Delete ${String(selectedForDelete.length)}`}
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
              {nameAlertMessage ||
                'Workspace names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setNameAlertOpen(false);
              }}
            >
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
