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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../../components/ui/alert-dialog';

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

type AddMode = 'DocLazyFrame' | 'LazyFrame' | 'DocDataFrame' | 'DataFrame';

interface StatusMessage {
  type: 'success' | 'error' | 'info';
  text: string;
}

const statusTone: Record<StatusMessage['type'], string> = {
  success: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  error: 'border-destructive bg-destructive/10 text-destructive',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
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
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [addFileName, setAddFileName] = useState<string | null>(null);
  const [importingSamples, setImportingSamples] = useState(false);
  const [workspaceAlertOpen, setWorkspaceAlertOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasWorkspaceSelected = Boolean(currentWorkspaceId);

  useEffect(() => {
    const active = workspaces.find((ws: any) => getWorkspaceId(ws) === currentWorkspaceId);
    if (active?.name) {
      setRenameValue(active.name);
    }
  }, [currentWorkspaceId, workspaces]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = window.setTimeout(() => setStatusMessage(null), 5000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

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
      setStatusMessage({ type: 'success', text: `Workspace "${trimmed}" created.` });
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Failed to create workspace.' });
    }
  }, [newWorkspaceDescription, newWorkspaceName, workspaceActions]);

  const handleRenameWorkspace = useCallback(async () => {
    if (!hasWorkspaceSelected || !renameValue.trim()) return;
    try {
      await workspaceActions.renameWorkspace(renameValue.trim());
      setStatusMessage({ type: 'success', text: 'Workspace renamed.' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Failed to rename workspace.' });
    }
  }, [hasWorkspaceSelected, renameValue, workspaceActions]);

  const handleSaveWorkspace = useCallback(async () => {
    if (!hasWorkspaceSelected) return;
    try {
      await workspaceActions.saveWorkspace();
      setStatusMessage({ type: 'success', text: 'Workspace saved.' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Failed to save workspace.' });
    }
  }, [hasWorkspaceSelected, workspaceActions]);

  const handleSaveWorkspaceAs = useCallback(async () => {
    if (!hasWorkspaceSelected) return;
    const filename = window.prompt('Enter filename for workspace export (e.g., my_workspace.json):');
    if (!filename) return;
    try {
      await workspaceActions.saveWorkspaceAs(filename.trim());
      setStatusMessage({ type: 'success', text: `Workspace saved as ${filename}.` });
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Failed to save workspace copy.' });
    }
  }, [hasWorkspaceSelected, workspaceActions]);

  const handleDeleteWorkspace = useCallback(async (workspaceId: string) => {
    const target = workspaces.find((ws: any) => getWorkspaceId(ws) === workspaceId);
    const confirmed = window.confirm(`Delete workspace ${target?.name || workspaceId}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await workspaceActions.deleteWorkspace(workspaceId);
      setStatusMessage({ type: 'success', text: 'Workspace deleted.' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Failed to delete workspace.' });
    }
  }, [workspaces, workspaceActions]);

  const handleImportSampleData = useCallback(async () => {
    setImportingSamples(true);
    setStatusMessage({ type: 'info', text: 'Importing sample data…' });
    try {
      await filesApi.importSampleData(authHeaders);
      await refetchFiles();
      setStatusMessage({ type: 'success', text: 'Sample data imported.' });
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Failed to import sample data.' });
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
        setStatusMessage({ type: 'success', text: `Uploaded ${file.name}.` });
      } else {
        setStatusMessage({ type: 'error', text: 'Upload failed.' });
      }
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Upload failed.' });
    } finally {
      event.target.value = '';
    }
  }, [handleUploadFile]);

  const handleAddToWorkspace = useCallback(async (options: { mode: AddMode; documentColumn?: string | null }) => {
    if (!addFileName) return;
    try {
      await workspaceActions.createNodeFromFile(addFileName, options);
      setStatusMessage({ type: 'success', text: `${addFileName} added to workspace.` });
    } catch (error) {
      setStatusMessage({ type: 'error', text: (error as Error).message || 'Failed to add file to workspace.' });
    } finally {
      setAddFileName(null);
    }
  }, [addFileName, workspaceActions]);

  const workspaceFolder = fileListResponse?.user_folder || dataFolder || 'data/';
  const workspaceBusy = isLoading.workspaces || isLoading.currentWorkspace;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Data Loader</h1>
        <p className="text-sm text-muted-foreground">
          Manage workspaces, upload corpora, and add files to the active workspace. Use this tab before running downstream analyses.
        </p>
        {statusMessage && (
          <div className={`rounded-md border px-4 py-2 text-sm ${statusTone[statusMessage.type]}`}>
            {statusMessage.text}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active workspace</CardTitle>
            <CardDescription>
              Choose or rename the workspace where new nodes will be added. Save regularly to persist your progress.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleSaveWorkspace} disabled={!hasWorkspaceSelected}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Save
              </Button>
              <Button variant="outline" onClick={handleSaveWorkspaceAs} disabled={!hasWorkspaceSelected}>
                <FolderPlus className="mr-2 h-4 w-4" /> Save as…
              </Button>
            </div>

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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Workspace manager</CardTitle>
            <CardDescription>Switch between saved workspaces or remove ones you no longer need.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {workspaceBusy && !sortedWorkspaces.length ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…
              </div>
            ) : sortedWorkspaces.length === 0 ? (
              <div className="rounded-md border border-dashed border-muted-foreground/60 px-4 py-3 text-sm text-muted-foreground">
                No workspaces yet. Create one to get started.
              </div>
            ) : (
              sortedWorkspaces.map((workspace: any) => {
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
                      {isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => workspaceActions.setCurrentWorkspace(null)}
                          disabled={workspaceBusy}
                        >
                          <LogOut className="mr-1.5 h-4 w-4" /> Unload
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteWorkspace(workspaceId)}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                      </Button>
                    </div>
                  </div>
                );
              })
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
                          <Button size="sm" onClick={() => {
                            if (!hasWorkspaceSelected) {
                              setWorkspaceAlertOpen(true);
                              return;
                            }
                            setAddFileName(file.filename);
                            setSelectedFile(file.filename);
                          }}>
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
    </div>
  );
};

export default DataLoaderFeature;
