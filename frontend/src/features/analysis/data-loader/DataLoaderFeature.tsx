import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, FolderPlus, Upload, Trash2, Eye, Download as DownloadIcon, Plus, RefreshCcw, LogOut } from 'lucide-react';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { useAuth } from '../../../hooks/useAuth';
import { useFiles } from '../../../hooks/useFiles';
import { filesApi } from '../../../api/files';
import { FileInfo } from '../../../types';
import { AddFilePanel, FilePreviewPanel } from '../../../components/panels';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Badge } from '../../../components/ui/badge';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';

const formatBytes = (bytes?: number | null): string => {
  if (!bytes || Number.isNaN(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`;
};

const formatTimestamp = (value?: number | string | null): string => {
  if (!value) return '—';
  let date: Date | null = null;
  if (typeof value === 'number') {
    date = new Date(value * (value > 1e12 ? 1 : 1000));
  } else if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      date = new Date(parsed);
    }
  }
  return date ? date.toLocaleString() : '—';
};

const getWorkspaceId = (workspace: Record<string, any>): string | null =>
  workspace?.workspace_id || workspace?.id || workspace?.unique_id || null;

export const DataLoaderFeature: React.FC = () => {
  const { workspaces, currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const workspaceActions = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();
  const { dataFolder, getAuthHeaders } = useAuth({ autoStart: true, debugLabel: 'DataLoaderFeature' });
  const authHeaders = useMemo(() => getAuthHeaders(), [getAuthHeaders]);

  const {
    files,
    fileListResponse,
    selectedFile,
    setSelectedFile,
    loadingFiles,
    loading: fileActionInFlight,
    uploading,
    handleUploadFile,
    handleDeleteFile,
    handleDownloadFile,
    refetchFiles,
  } = useFiles({ authHeaders });

  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDescription, setNewWorkspaceDescription] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [addFileName, setAddFileName] = useState<string | null>(null);
  const [importingSamples, setImportingSamples] = useState(false);
  const [workspaceAlertOpen, setWorkspaceAlertOpen] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<{ id: string; name?: string | null } | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasWorkspaceSelected = Boolean(currentWorkspaceId);

  const notify = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const duration = type === 'error' ? 6000 : 3500;
    if (type === 'success') {
      toast.success(message, { duration });
    } else if (type === 'error') {
      toast.error(message, { duration });
    } else {
      toast(message, { duration });
    }
  }, []);

  useEffect(() => {
    const active = workspaces.find((ws: any) => getWorkspaceId(ws) === currentWorkspaceId);
    if (active?.name) {
      setRenameValue(active.name);
    }
  }, [currentWorkspaceId, workspaces]);

  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((a: any, b: any) => {
      const aTime = Date.parse(a?.modified_at || a?.updated_at || a?.created_at || '');
      const bTime = Date.parse(b?.modified_at || b?.updated_at || b?.created_at || '');
      return (bTime || 0) - (aTime || 0);
    });
  }, [workspaces]);

  const sortedFiles = useMemo(() => (
    [...files].sort((a: FileInfo, b: FileInfo) => (b.created_at || 0) - (a.created_at || 0))
  ), [files]);

  const currentWorkspace = useMemo(() => (
    workspaces.find((ws: any) => getWorkspaceId(ws) === currentWorkspaceId) || null
  ), [workspaces, currentWorkspaceId]);

  const nodeCount = workspaceGraph?.nodes?.length ?? currentWorkspace?.dataframe_count ?? currentWorkspace?.node_count ?? 0;

  const handleCreateWorkspace = useCallback(async () => {
    const trimmed = newWorkspaceName.trim();
    if (!trimmed) return;
    try {
      await workspaceActions.createWorkspace(trimmed, newWorkspaceDescription.trim() || undefined);
      setNewWorkspaceName('');
      setNewWorkspaceDescription('');
      notify('success', `Workspace "${trimmed}" created.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to create workspace.');
    }
  }, [newWorkspaceDescription, newWorkspaceName, notify, workspaceActions]);

  const handleRenameWorkspace = useCallback(async () => {
    if (!hasWorkspaceSelected || !renameValue.trim()) return;
    try {
      await workspaceActions.renameWorkspace(renameValue.trim());
      notify('success', 'Workspace renamed.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to rename workspace.');
    }
  }, [hasWorkspaceSelected, notify, renameValue, workspaceActions]);

  const handleSaveWorkspace = useCallback(async () => {
    if (!hasWorkspaceSelected) return;
    try {
      await workspaceActions.saveWorkspace();
      notify('success', 'Workspace saved.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to save workspace.');
    }
  }, [hasWorkspaceSelected, notify, workspaceActions]);

  const handleSaveWorkspaceAs = useCallback(async () => {
    if (!hasWorkspaceSelected) return;
    setSaveAsOpen(true);
  }, [hasWorkspaceSelected]);

  const confirmSaveAs = useCallback(async () => {
    if (!saveAsName.trim()) return;
    try {
      await workspaceActions.saveWorkspaceAs(saveAsName.trim());
      notify('success', `Workspace saved as ${saveAsName}.`);
      setSaveAsOpen(false);
      setSaveAsName('');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to save workspace copy.');
    }
  }, [notify, saveAsName, workspaceActions]);

  const openDeleteWorkspaceDialog = useCallback(
    (workspaceId: string) => {
      const target = workspaces.find((ws: any) => getWorkspaceId(ws) === workspaceId);
      setWorkspaceToDelete({ id: workspaceId, name: target?.name });
    },
    [workspaces],
  );

  const handleConfirmDeleteWorkspace = useCallback(async () => {
    if (!workspaceToDelete) return;
    setDeletingWorkspace(true);
    try {
      await workspaceActions.deleteWorkspace(workspaceToDelete.id);
      notify('success', 'Workspace deleted.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to delete workspace.');
    } finally {
      setDeletingWorkspace(false);
      setWorkspaceToDelete(null);
    }
  }, [notify, workspaceActions, workspaceToDelete]);

  const handleImportSampleData = useCallback(async () => {
    setImportingSamples(true);
    try {
      await toast.promise(
        filesApi.importSampleData(authHeaders).then(async () => {
          await refetchFiles();
        }),
        {
          loading: 'Importing sample data…',
          success: 'Sample data imported.',
          error: (error) => (error as Error)?.message || 'Failed to import sample data.',
        },
      );
    } catch (error) {
      console.error('[DataLoaderFeature] import sample data failed', error);
    } finally {
      setImportingSamples(false);
    }
  }, [authHeaders, refetchFiles]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const success = await handleUploadFile(file);
      if (success) {
        notify('success', `Uploaded ${file.name}.`);
      } else {
        notify('error', 'Upload failed.');
      }
    } catch (error) {
      notify('error', (error as Error).message || 'Upload failed.');
    } finally {
      event.target.value = '';
    }
  }, [handleUploadFile, notify]);

  const handleAddToWorkspace = useCallback(async () => {
    if (!addFileName) return;
    try {
      await workspaceActions.createNodeFromFile(addFileName);
      notify('success', `${addFileName} added to workspace.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to add file to workspace.');
    } finally {
      setAddFileName(null);
    }
  }, [addFileName, notify, workspaceActions]);

  const workspaceFolder = fileListResponse?.user_folder || dataFolder || 'data/';
  const workspaceBusy = isLoading.workspaces || isLoading.currentWorkspace;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Data Loader</h1>
        <p className="text-sm text-muted-foreground">
          Manage workspaces, upload corpora, and add files to the active workspace. Use this tab before running downstream analyses.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex h-[480px] flex-col">
          <CardHeader>
            <CardTitle>Active workspace</CardTitle>
            <CardDescription>
              Choose or rename the workspace where new nodes will be added. Save regularly to persist your progress.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 space-y-4 overflow-y-auto pr-1">
            {currentWorkspace ? (
              <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                  {currentWorkspace.name}
                  <Badge>{nodeCount} nodes</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Updated {formatTimestamp(currentWorkspace.modified_at || currentWorkspace.updated_at)} · Created {formatTimestamp(currentWorkspace.created_at)}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-muted-foreground/50 px-4 py-3 text-sm text-muted-foreground">
                No workspace selected. Pick one below or create a new workspace.
              </div>
            )}

            {hasWorkspaceSelected && (
              <div className="space-y-2">
                <Label htmlFor="rename-workspace">Rename workspace</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="rename-workspace"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    placeholder="Enter new name"
                    disabled={!hasWorkspaceSelected || workspaceBusy}
                  />
                  <Button onClick={handleRenameWorkspace} disabled={!hasWorkspaceSelected || !renameValue.trim()}>
                    Rename
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleSaveWorkspace} disabled={!hasWorkspaceSelected}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Save
              </Button>
              <Button variant="outline" onClick={handleSaveWorkspaceAs} disabled={!hasWorkspaceSelected}>
                <FolderPlus className="mr-2 h-4 w-4" /> Save as…
              </Button>
              <Button
                variant="outline"
                onClick={() => workspaceActions.setCurrentWorkspace(null)}
                disabled={!hasWorkspaceSelected || workspaceBusy}
              >
                <LogOut className="mr-2 h-4 w-4" /> Unload
              </Button>
            </div>

            {!hasWorkspaceSelected && (
              <div className="space-y-2">
                <Label htmlFor="new-workspace-name">Create workspace</Label>
                <Input
                  id="new-workspace-name"
                  value={newWorkspaceName}
                  onChange={(event) => setNewWorkspaceName(event.target.value)}
                  placeholder="Workspace name"
                />
                <Input
                  value={newWorkspaceDescription}
                  onChange={(event) => setNewWorkspaceDescription(event.target.value)}
                  placeholder="Optional description"
                />
                <Button onClick={handleCreateWorkspace} disabled={!newWorkspaceName.trim()}>
                  <Plus className="mr-2 h-4 w-4" /> Create workspace
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex h-[480px] flex-col">
          <CardHeader>
            <CardTitle>Workspace manager</CardTitle>
            <CardDescription>Switch between saved workspaces or remove ones you no longer need.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col overflow-hidden">
            {workspaceBusy && !sortedWorkspaces.length ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…
              </div>
            ) : sortedWorkspaces.length === 0 ? (
              <div className="rounded-md border border-dashed border-muted-foreground/60 px-4 py-3 text-center text-sm text-muted-foreground">
                No workspaces yet. Create one to get started.
              </div>
            ) : (
              <div className="space-y-3 overflow-y-auto pr-2">
                {sortedWorkspaces.map((workspace: any) => {
                  const workspaceId = getWorkspaceId(workspace);
                  if (!workspaceId) return null;
                  const isActive = workspaceId === currentWorkspaceId;
                  return (
                    <div
                      key={workspaceId}
                      className={`flex flex-col gap-2 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                        isActive ? 'border-primary bg-primary/5' : 'border-border/70 bg-background'
                      }`}
                    >
                      <div>
                        <div className="font-medium text-foreground">{workspace.name || workspaceId}</div>
                        <div className="text-xs text-muted-foreground">
                          Updated {formatTimestamp(workspace.modified_at || workspace.updated_at)} · {workspace.dataframe_count ?? workspace.node_count ?? 0} nodes
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={isActive ? 'outline' : 'secondary'}
                          onClick={() => workspaceActions.setCurrentWorkspace(workspaceId)}
                          disabled={isActive}
                        >
                          {isActive ? 'Active' : 'Activate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => openDeleteWorkspaceDialog(workspaceId)}
                        >
                          <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Files & uploads</CardTitle>
          <CardDescription>
            Upload CSV, TSV, Excel, or JSON files, preview them, and add them to the active workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={openFilePicker} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload file'}
            </Button>
            <Button variant="outline" onClick={handleImportSampleData} disabled={importingSamples}>
              <FolderPlus className="mr-2 h-4 w-4" /> {importingSamples ? 'Importing…' : 'Import sample data'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileInputChange}
            />
            <div className="text-xs text-muted-foreground">
              Stored under <span className="font-mono">{workspaceFolder}</span>
            </div>
          </div>

          {loadingFiles ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
            </div>
          ) : sortedFiles.length === 0 ? (
            <div className="rounded-md border border-dashed border-muted-foreground/60 px-4 py-3 text-sm text-muted-foreground">
              No files found. Upload a dataset to begin.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="hidden md:table-cell">Size</TableHead>
                    <TableHead className="hidden lg:table-cell">Updated</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFiles.map((file) => (
                    <TableRow key={file.filename} className={selectedFile === file.filename ? 'bg-muted/50' : undefined}>
                      <TableCell>
                        <div className="font-medium text-foreground">{file.display_name || file.filename}</div>
                        <div className="text-xs text-muted-foreground font-mono">{file.filename}</div>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{formatBytes(file.size)}</TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatTimestamp(file.modified)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setPreviewFile(file.filename)}>
                            <Eye className="mr-1.5 h-4 w-4" /> Preview
                          </Button>
                          <Button
                            size="sm"
                            disabled={!hasWorkspaceSelected}
                            onClick={() => {
                              if (!hasWorkspaceSelected) {
                                setWorkspaceAlertOpen(true);
                                return;
                              }
                              setAddFileName(file.filename);
                              setSelectedFile(file.filename);
                            }}
                          >
                            <Plus className="mr-1.5 h-4 w-4" /> Add
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleDownloadFile(file.filename)}>
                            <DownloadIcon className="mr-1.5 h-4 w-4" /> Download
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDeleteFile(file.filename)}
                            disabled={fileActionInFlight}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>Total files: {sortedFiles.length}</div>
        </CardFooter>
      </Card>

      <FilePreviewPanel filename={previewFile} open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} />
      <AddFilePanel
        filename={addFileName}
        open={Boolean(addFileName)}
        onClose={() => setAddFileName(null)}
        onConfirm={handleAddToWorkspace}
      />
      <AlertDialog open={workspaceAlertOpen} onOpenChange={setWorkspaceAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>No workspace selected</AlertDialogTitle>
            <AlertDialogDescription>
              Choose or create a workspace in the Active workspace panel before adding files. The Add action will be available once a workspace is active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setWorkspaceAlertOpen(false)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(workspaceToDelete)} onOpenChange={(open) => !open && setWorkspaceToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {workspaceToDelete
                ? `This will permanently delete "${workspaceToDelete.name || workspaceToDelete.id}" and its data. This action cannot be undone.`
                : 'This will permanently delete the workspace and its data. This action cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setWorkspaceToDelete(null)} disabled={deletingWorkspace}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteWorkspace}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingWorkspace}
            >
              {deletingWorkspace ? 'Deleting…' : 'Delete workspace'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={saveAsOpen} onOpenChange={setSaveAsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Workspace As</DialogTitle>
            <DialogDescription>
              Enter a filename for the workspace export (e.g., my_workspace.json)
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              placeholder="filename.json"
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmSaveAs();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSaveAs}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataLoaderFeature;
