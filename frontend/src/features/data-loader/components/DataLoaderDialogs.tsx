import React from 'react';
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
import type { FileTreeDirectory } from '@/types';

export type DataLoaderDialogsProps = {
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
  deleteFolder: {
    target: { path: string; name: string; fileCount: number } | null;
    deleting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
  };
  ldacaImport: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    url: string;
    onUrlChange: (url: string) => void;
    importing: boolean;
    onImport: () => void;
  };
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
};

export const DataLoaderDialogs: React.FC<DataLoaderDialogsProps> = ({
  noWorkspaceAlert,
  workspaceNameAlert,
  folderNameAlert,
  deleteWorkspace,
  deleteFolder,
  ldacaImport,
  createFolder,
  citation,
}) => {
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
              Choose or create a workspace in the Active workspace panel before adding files. The Add action will be available once a workspace is active.
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
              {workspaceNameAlert.message || 'Workspace names cannot include path separators or traversal sequences.'}
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
                ? `This will permanently delete "${deleteWorkspace.target.name || deleteWorkspace.target.id}" and its data. This action cannot be undone.`
                : 'This will permanently delete the workspace and its data. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={deleteWorkspace.onCancel} disabled={deleteWorkspace.deleting}>
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

      <AlertDialog
        open={Boolean(deleteFolder.target)}
        onOpenChange={(open) => {
          if (!open) deleteFolder.onCancel();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFolder.target
                ? deleteFolder.target.fileCount > 0
                  ? `This will permanently delete the folder "${deleteFolder.target.name}" and its ${deleteFolder.target.fileCount} file${deleteFolder.target.fileCount === 1 ? '' : 's'}. Any workspace nodes already added from these files will keep their own copy and are unaffected. This action cannot be undone.`
                  : `This will permanently delete the empty folder "${deleteFolder.target.name}".`
                : 'This will permanently delete the folder.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={deleteFolder.onCancel} disabled={deleteFolder.deleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteFolder.onConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteFolder.deleting}
            >
              {deleteFolder.deleting ? 'Deleting…' : 'Delete folder'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={ldacaImport.open} onOpenChange={ldacaImport.onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from LDaCA</DialogTitle>
            <DialogDescription>
              Enter the LDaCA Zip URL to download and convert the dataset. This will run as a background task.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>LDaCA URL</Label>
              <Input
                value={ldacaImport.url}
                onChange={(event) => ldacaImport.onUrlChange(event.target.value)}
                placeholder="https://data.ldaca.edu.au/..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => ldacaImport.onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={ldacaImport.onImport} disabled={ldacaImport.importing || !ldacaImport.url.trim()}>
              {ldacaImport.importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createFolder.open}
        onOpenChange={(open) => {
          createFolder.onOpenChange(open);
          if (!open) createFolder.onNameChange('');
        }}
      >
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
                onChange={(event) => createFolder.onNameChange(event.target.value)}
                placeholder="Enter folder name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => createFolder.onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={createFolder.onCreate} disabled={createFolder.creating || !createFolder.name.trim()}>
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
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading citation…
            </div>
          ) : citation.content ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{citation.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No citation available for this folder.</p>
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
              {folderNameAlert.message || 'Folder names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={folderNameAlert.onClose}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default DataLoaderDialogs;
