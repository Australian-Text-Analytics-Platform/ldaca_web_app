import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FileTreeDirectory } from '@/features/views/data-loader/types';
import { LdacaImportDialog, type LdacaImportDialogProps } from './LdacaImportDialog';

export interface DataLoaderDialogsProps {
  noWorkspaceAlert: {
    open: boolean;
    onClose: () => void;
  };
  workspaceNameAlert: {
    message: string | null;
    onClose: () => void;
  };
  folderNameAlert: {
    message: string | null;
    onClose: () => void;
  };
  deleteWorkspace: {
    target: { id: string; name?: string | null } | null;
    deleting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  };
  ldacaImport: LdacaImportDialogProps;
  createFolder: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parentPath: string;
    parentLabel: string;
    name: string;
    onNameChange: (value: string) => void;
    creating: boolean;
    onCreate: () => void;
  };
  citation: {
    directory: FileTreeDirectory | null;
    path: string | null;
    content: string | null;
    loading: boolean;
    onClose: () => void;
  };
}

/**
 * Collects the modal/dialog surfaces owned by the Data Loader. The feature
 * passes state and callbacks here so destructive confirmations, token entry,
 * folder creation, citation viewing, and Oni imports stay visually colocated.
 * Rendered by: useFolderCreation hook, useDataLoaderWorkspaceActions hook, DataLoaderFeature module (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: render each modal from hook-owned state, wire form fields to hook setters, then
 * delegate confirmations/import/search actions back to DataLoaderFeature hooks.
 */
export function DataLoaderDialogs({
  noWorkspaceAlert,
  workspaceNameAlert,
  folderNameAlert,
  deleteWorkspace,
  ldacaImport,
  createFolder,
  citation,
}: DataLoaderDialogsProps) {
  return (
    <>
      <AlertDialog
        open={noWorkspaceAlert.open}
        onOpenChange={(open) => {
          if (!open) noWorkspaceAlert.onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No workspace selected</AlertDialogTitle>
            <AlertDialogDescription>
              Choose or create a workspace in the Active workspace panel before adding files. The
              Add action will be available once a workspace is active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={noWorkspaceAlert.onClose}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(workspaceNameAlert.message)}
        onOpenChange={(open) => {
          if (!open) workspaceNameAlert.onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid workspace name</AlertDialogTitle>
            <AlertDialogDescription>
              {/* an empty alert message should fall through to the default copy */}
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
              {workspaceNameAlert.message ||
                'Workspace names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={workspaceNameAlert.onClose}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteWorkspace.target)}
        onOpenChange={(open) => {
          if (!open) deleteWorkspace.onCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteWorkspace.target
                ? // an empty workspace name should fall through to the id
                  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                  `This will permanently delete "${deleteWorkspace.target.name || deleteWorkspace.target.id}" and its data. This action cannot be undone.`
                : 'This will permanently delete the workspace and its data. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={deleteWorkspace.onCancel}
              disabled={deleteWorkspace.deleting}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteWorkspace.onConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteWorkspace.deleting}
            >
              {deleteWorkspace.deleting ? 'Deleting…' : 'Delete workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LdacaImportDialog {...ldacaImport} />

      <Dialog open={createFolder.open} onOpenChange={createFolder.onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
            <DialogDescription>
              {createFolder.parentPath
                ? `Create a subfolder inside ${createFolder.parentLabel}.`
                : 'Create a folder under the root files directory.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-folder-name">Folder name</Label>
              <Input
                id="new-folder-name"
                value={createFolder.name}
                onChange={(event) => {
                  createFolder.onNameChange(event.target.value);
                }}
                placeholder="Enter folder name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                createFolder.onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={createFolder.onCreate}
              disabled={createFolder.creating || !createFolder.name.trim()}
            >
              {createFolder.creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(citation.directory)}
        onOpenChange={(open) => {
          if (!open) citation.onClose();
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Citation</DialogTitle>
            <DialogDescription>
              {citation.path ? `Source: ${citation.path}` : 'Citation metadata'}
            </DialogDescription>
          </DialogHeader>
          {citation.loading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading citation…
            </div>
          ) : citation.content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{citation.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No citation available for this folder.</p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(folderNameAlert.message)}
        onOpenChange={(open) => {
          if (!open) folderNameAlert.onClose();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid folder name</AlertDialogTitle>
            <AlertDialogDescription>
              {/* an empty alert message should fall through to the default copy */}
              {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
              {folderNameAlert.message ||
                'Folder names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={folderNameAlert.onClose}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
