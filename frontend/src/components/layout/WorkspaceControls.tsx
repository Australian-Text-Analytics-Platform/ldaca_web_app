import { useState } from 'react';
import { PanelRightClose, Pencil } from 'lucide-react';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import { getInvalidWorkspaceNameMessage } from '@/features/workspace/common/workspaceName';
import HelpIcon from '@/components/help/HelpIcon';

/**
 * Workspace graph toolbar used above the graph pane. It centralizes workspace
 * rename and help controls; graph actions live on the graph canvas.
 * Rendered by: WorkspaceView above the graph canvas.
 * Flow: read workspace identity, manage rename validation, then render header controls.
 *
 * ``onToggleCollapse`` renders the collapse button. The collapsed shell
 * returns before mounting this toolbar, so controls only model the live graph
 * view and carry no unreachable compact-mode branch.
 */
export function WorkspaceControls({ onToggleCollapse }: { onToggleCollapse?: () => void } = {}) {
  const { currentWorkspace } = useWorkspaceData();
  const { renameWorkspace } = useWorkspaceActions();

  const [renameDraft, setRenameDraft] = useState<{ baseName: string; value: string }>();
  const [nameAlertOpen, setNameAlertOpen] = useState(false);
  const [nameAlertMessage, setNameAlertMessage] = useState('');
  const currentWorkspaceName = currentWorkspace?.name ?? '';
  const isEditing = renameDraft?.baseName === currentWorkspaceName;

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

  /** Called by: the WorkspaceControls Rename button onClick prop. */
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
        <button
          className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 px-2 py-1 border rounded"
          onClick={startRename}
          title="Rename"
          aria-label="Rename workspace"
        >
          <Pencil className="h-3 w-3" />
          Rename
        </button>
      )}

      <AlertDialog open={nameAlertOpen} onOpenChange={setNameAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid workspace name</AlertDialogTitle>
            <AlertDialogDescription>{nameAlertMessage}</AlertDialogDescription>
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
