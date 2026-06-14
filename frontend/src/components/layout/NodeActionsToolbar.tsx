import { useState } from 'react';
import { Settings2, Plus, Trash2, Search } from 'lucide-react';
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
export interface NodeActionsToolbarNode {
  id: string;
  name: string;
  canUndo?: boolean;
  canRedo?: boolean;
}

export interface NodeActionsToolbarProps {
  node: NodeActionsToolbarNode;
  onShowSchema: (nodeId: string) => void;
  onAddToSelection: (nodeId: string) => void;
  onRename: (nodeId: string, newName: string) => void;
  onClone: (nodeId: string) => void;
  onUndo: (nodeId: string) => void;
  onRedo: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
}

/**
 * Compact per-node action toolbar rendered at the end of each row in the
 * right-panel Workspace List View. Mirrors the graph node's hover toolbar
 * (settings menu with Rename / Clone / Undo / Redo / Delete, an add-to-inputs
 * button, and a delete button) and adds a schema magnifier so the user can open
 * a node's schema in the collapsed data view.
 *
 * Rendered by: WorkspaceListView via WorkspaceNodeList's ``renderRowActions``
 * slot. Wired to the same workspace actions the graph uses (delete/rename/clone/
 * undo/redo) plus the node-input add request and the schema-view selector.
 *
 * Flow: render icon buttons; the settings menu and the inline rename/delete
 * dialogs own their open state locally and call back into the workspace actions
 * passed by the list view.
 */
export function NodeActionsToolbar({
  node,
  onShowSchema,
  onAddToSelection,
  onRename,
  onClone,
  onUndo,
  onRedo,
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

  const iconButtonClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-gray-600 shadow-sm transition-colors hover:bg-muted hover:text-gray-900';

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => { onShowSchema(node.id); }}
        className={iconButtonClass}
        title="View schema"
        aria-label={`View schema for ${node.name}`}
      >
        <Search className="h-4 w-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={iconButtonClass}
            title="More options"
            aria-label={`Actions for ${node.name}`}
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuItem onSelect={openRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { onClone(node.id); }}>Clone</DropdownMenuItem>
          <DropdownMenuItem
            disabled={!node.canUndo}
            onSelect={() => {
              if (node.canUndo) onUndo(node.id);
            }}
          >
            Undo
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!node.canRedo}
            onSelect={() => {
              if (node.canRedo) onRedo(node.id);
            }}
          >
            Redo
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-red-600 focus:text-red-700"
            onSelect={() => { setDeleteOpen(true); }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={() => { onAddToSelection(node.id); }}
        className={iconButtonClass}
        title="Add to selection"
        aria-label={`Add ${node.name} to selection`}
      >
        <Plus className="h-4 w-4" />
      </button>

      <button
        type="button"
        onClick={() => { setDeleteOpen(true); }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-red-600 shadow-sm transition-colors hover:bg-red-50 hover:text-red-700"
        title="Delete data block"
        aria-label={`Delete ${node.name}`}
      >
        <Trash2 className="h-4 w-4" />
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
            onChange={(event) => { setRenameValue(event.target.value); }}
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
              onClick={() => { onDelete(node.id); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
