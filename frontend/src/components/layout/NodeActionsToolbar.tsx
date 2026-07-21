import { useState } from 'react';
import { Pin, Settings2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Minimal node shape the row toolbar needs. */
interface NodeActionsToolbarNode {
  id: string;
  name: string;
}

export interface NodeActionsToolbarProps {
  node: NodeActionsToolbarNode;
  isPinned: boolean;
  onTogglePin: (nodeId: string) => void;
  onAddToSelection: (nodeId: string) => void;
  onRename: (nodeId: string, newName: string) => void;
  onClone: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

const iconButtonClass =
  'inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-white text-gray-600 shadow-sm transition-colors hover:bg-muted hover:text-gray-900';

interface NodePinButtonProps {
  node: NodeActionsToolbarNode;
  isPinned: boolean;
  onTogglePin: (nodeId: string) => void;
}

/**
 * Single pin action shared by the full row toolbar and the pinned row's resting
 * affordance.
 * Rendered by: NodeActionsToolbar for hovered rows and WorkspaceListView for
 * pinned rows at rest because only the pin icon should remain visible when the
 * full toolbar is hidden.
 */
export function NodePinButton({ node, isPinned, onTogglePin }: NodePinButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        onTogglePin(node.id);
      }}
      className={cn(
        iconButtonClass,
        isPinned &&
          'border-primary/70 bg-primary/10 text-primary shadow-md hover:bg-primary/15 hover:text-primary',
      )}
      title={isPinned ? 'Unpin data block' : 'Pin data block'}
      aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${node.name}`}
      data-pin-action
      data-pinned={isPinned ? 'true' : 'false'}
    >
      <Pin
        className={cn(
          'h-3.5 w-3.5 transition-transform',
          isPinned && '-rotate-45 translate-y-0.5 fill-current',
        )}
      />
    </button>
  );
}

/**
 * Compact per-node action toolbar rendered at the end of each row in the
 * right-panel Workspace List View. Mirrors the graph node's hover toolbar
 * (settings menu with Rename / Clone / Undo / Redo / Delete, and an add-to-inputs
 * button) with hover action overlay.
 *
 * Rendered by: WorkspaceListView via WorkspaceNodeList's ``renderRowActions``
 * slot. Wired to the same workspace actions the graph uses (delete/rename/clone/
 * undo/redo) plus the node-input add request.
 *
 * Flow: render icon buttons; the settings menu and the inline rename/delete
 * dialogs own their open state locally and call back into the workspace actions
 * passed by the list view.
 */
export function NodeActionsToolbar({
  node,
  isPinned,
  onTogglePin,
  onAddToSelection,
  onRename,
  onClone,
  onDelete,
}: NodeActionsToolbarProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [deleteOpen, setDeleteOpen] = useState(false);

  /** Opens the rename dialog seeded with the current name. */
  const openRename = () => {
    setRenameValue(node.name);
    setRenameOpen(true);
  };

  /** Commits the rename when the trimmed value is non-empty and changed. */
  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== node.name) onRename(node.id, trimmed);
    setRenameOpen(false);
  };

  return (
    <div className="flex items-center gap-1">
      <NodePinButton node={node} isPinned={isPinned} onTogglePin={onTogglePin} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={iconButtonClass}
            title="More options"
            aria-label={`Actions for ${node.name}`}
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem onSelect={openRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              onClone(node.id);
            }}
          >
            Clone
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-red-600 focus:text-red-700"
            onSelect={() => {
              setDeleteOpen(true);
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={() => {
          onAddToSelection(node.id);
        }}
        className={iconButtonClass}
        title="Add to selection"
        aria-label={`Add ${node.name} to selection`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <AlertDialog open={renameOpen} onOpenChange={setRenameOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename data block</AlertDialogTitle>
            <AlertDialogDescription>
              Enter a new name for &ldquo;{node.name}&rdquo;.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => {
              setRenameValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRename();
              }
            }}
            aria-label="New data block name"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={commitRename} disabled={!renameValue.trim()}>
              Rename
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{node.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this data block and its data. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                onDelete(node.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
