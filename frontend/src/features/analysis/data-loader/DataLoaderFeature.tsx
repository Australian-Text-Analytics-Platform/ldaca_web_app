import React, { useEffect, useRef, useState } from 'react';
import { Loader2, FolderPlus, Upload, Trash2, Eye, Download as DownloadIcon, Plus, RefreshCcw, LogOut, Quote } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '../../../hooks/useWorkspaceData';
import { useWorkspaceActions } from '../../../hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '../../../hooks/useWorkspaceStatus';
import { useAuth } from '../../../hooks/useAuth';
import { useFiles } from '../../../hooks/useFiles';
import { queryKeys } from '../../../lib/queryKeys';
import { filesApi } from '../../../api/files';
import { workspacesApi } from '../../../api/workspaces';
import { useAnalysisStore, TaskItem } from '../../../stores/analysisStore';
import { FileInfo } from '../../../types';
import { AddFilePanel, FilePreviewPanel } from '../../../components/panels';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { Badge } from '../../../components/ui/badge';
import { toast } from 'sonner';
import { getInvalidWorkspaceNameMessage } from '../../../lib/workspaceName';
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
import HelpIcon from '../../../components/help/HelpIcon';

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
  const queryClient = useQueryClient();
  const { workspaces, currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const workspaceActions = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();
  const { dataFolder, getAuthHeaders } = useAuth({ autoStart: true, debugLabel: 'DataLoaderFeature' });
  const authHeaders = getAuthHeaders();

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
  const [workspaceNameAlert, setWorkspaceNameAlert] = useState<string | null>(null);
  const [ldacaImportOpen, setLdacaImportOpen] = useState(false);
  const [ldacaUrl, setLdacaUrl] = useState('');
  const [ldacaImporting, setLdacaImporting] = useState(false);
  const [citationFile, setCitationFile] = useState<FileInfo | null>(null);
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false);
  const [refreshingFiles, setRefreshingFiles] = useState(false);
  const [uploadingWorkspaceZip, setUploadingWorkspaceZip] = useState(false);
  const [downloadingWorkspaceId, setDownloadingWorkspaceId] = useState<string | null>(null);
  const [pendingDownloads, setPendingDownloads] = useState<Record<string, { taskId: string; workspaceName: string }>>({});
  const tasks = useAnalysisStore((state) => state.tasks);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceZipInputRef = useRef<HTMLInputElement | null>(null);
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const [activeCardHeight, setActiveCardHeight] = useState<number | null>(null);
  const hasWorkspaceSelected = Boolean(currentWorkspaceId);

  const notify = (type: 'success' | 'error' | 'info', message: string) => {
    const duration = type === 'error' ? 6000 : 3500;
    if (type === 'success') {
      toast.success(message, { duration });
    } else if (type === 'error') {
      toast.error(message, { duration });
    } else {
      toast(message, { duration });
    }
  };

  useEffect(() => {
    const active = workspaces.find((ws: any) => getWorkspaceId(ws) === currentWorkspaceId);
    if (active?.name) {
      setRenameValue(active.name);
    }
  }, [currentWorkspaceId, workspaces]);

  useEffect(() => {
    const element = activeCardRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextHeight = Math.round(entry.contentRect.height);
      setActiveCardHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sortedWorkspaces = [...workspaces].sort((a: any, b: any) => {
    const aTime = Date.parse(a?.modified_at || a?.updated_at || a?.created_at || '');
    const bTime = Date.parse(b?.modified_at || b?.updated_at || b?.created_at || '');
    return (bTime || 0) - (aTime || 0);
  });

  const sortedFiles = [...files].sort((a: FileInfo, b: FileInfo) => a.filename.localeCompare(b.filename));

  const currentWorkspace = workspaces.find((ws: any) => getWorkspaceId(ws) === currentWorkspaceId) || null;

  const nodeCount = workspaceGraph?.nodes?.length ?? currentWorkspace?.dataframe_count ?? currentWorkspace?.node_count ?? 0;

  const handleCreateWorkspace = async () => {
    const trimmed = newWorkspaceName.trim();
    if (!trimmed) return;
    try {
      await workspaceActions.createWorkspace(trimmed, newWorkspaceDescription.trim() || undefined);
      setNewWorkspaceName('');
      setNewWorkspaceDescription('');
      notify('success', `Workspace "${trimmed}" created.`);
    } catch (error) {
      const message = getInvalidWorkspaceNameMessage(error);
      if (message) {
        setWorkspaceNameAlert(message);
        return;
      }
      notify('error', (error as Error).message || 'Failed to create workspace.');
    }
  };

  const handleRenameWorkspace = async () => {
    try {
      await workspaceActions.renameWorkspace(renameValue.trim());
      notify('success', 'Workspace renamed.');
    } catch (error) {
      const message = getInvalidWorkspaceNameMessage(error);
      if (message) {
        setWorkspaceNameAlert(message);
        return;
      }
      notify('error', (error as Error).message || 'Failed to rename workspace.');
    }
  };

  const handleSaveWorkspace = async () => {
    if (!hasWorkspaceSelected) return;
    try {
      await workspaceActions.saveWorkspace();
      notify('success', 'Workspace saved.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to save workspace.');
    }
  };

  const handleSaveWorkspaceAs = async () => {
    if (!hasWorkspaceSelected) return;
    setSaveAsOpen(true);
  };

  const confirmSaveAs = async () => {
    if (!saveAsName.trim()) return;
    try {
      await workspaceActions.saveWorkspaceAs(saveAsName.trim());
      notify('success', `Workspace saved as ${saveAsName}.`);
      setSaveAsOpen(false);
      setSaveAsName('');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to save workspace copy.');
    }
  };

  const openDeleteWorkspaceDialog = (workspaceId: string) => {
    const target = workspaces.find((ws: any) => getWorkspaceId(ws) === workspaceId);
    setWorkspaceToDelete({ id: workspaceId, name: target?.name });
  };

  const handleConfirmDeleteWorkspace = async () => {
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
  };

  const handleImportSampleData = async () => {
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
  };

  const handleRefreshWorkspaces = async () => {
    setRefreshingWorkspaces(true);
    try {
      await queryClient.refetchQueries({
        queryKey: queryKeys.workspaces,
        exact: true,
      });
      notify('success', 'Workspace list refreshed.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to refresh workspace list.');
    } finally {
      setRefreshingWorkspaces(false);
    }
  };

  const openWorkspaceZipPicker = () => {
    workspaceZipInputRef.current?.click();
  };

  const handleWorkspaceZipInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setUploadingWorkspaceZip(true);
      await workspacesApi.uploadZip(file, authHeaders);
      await queryClient.refetchQueries({ queryKey: queryKeys.workspaces, exact: true });
      notify('success', `Workspace ZIP "${file.name}" uploaded.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to upload workspace ZIP.');
    } finally {
      setUploadingWorkspaceZip(false);
      event.target.value = '';
    }
  };

  const handleDownloadWorkspaceZip = async (workspaceId: string, workspaceName: string) => {
    try {
      setDownloadingWorkspaceId(workspaceId);
      const response = await workspacesApi.startDownloadTask(workspaceId, authHeaders);
      const taskId = response?.metadata?.task_id;
      if (!taskId) throw new Error('No task ID returned');
      setPendingDownloads((prev) => ({ ...prev, [workspaceId]: { taskId, workspaceName } }));
      notify('info', 'Preparing workspace download…');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to start workspace download.');
    } finally {
      setDownloadingWorkspaceId(null);
    }
  };

  // Auto-download when a workspace_download task completes
  useEffect(() => {
    const entries = Object.entries(pendingDownloads);
    if (!entries.length) return;

    for (const [workspaceId, { taskId, workspaceName }] of entries) {
      const task = tasks.find((t: TaskItem) => t.task_id === taskId);
      if (!task) continue;

      if (task.state === 'successful') {
        // Remove from pending immediately to prevent double-trigger
        setPendingDownloads((prev) => {
          const next = { ...prev };
          delete next[workspaceId];
          return next;
        });
        // Fetch the artifact and trigger browser download
        (async () => {
          try {
            const blob = await workspacesApi.downloadTaskArtifact(workspaceId, taskId, authHeaders);
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = `${(workspaceName || workspaceId).replace(/[^a-zA-Z0-9._-]+/g, '_')}.zip`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(objectUrl);
            notify('success', `Downloaded workspace "${workspaceName || workspaceId}".`);
          } catch (err) {
            notify('error', (err as Error).message || 'Failed to download workspace ZIP.');
          }
        })();
      } else if (task.state === 'failed' || task.state === 'cancelled') {
        setPendingDownloads((prev) => {
          const next = { ...prev };
          delete next[workspaceId];
          return next;
        });
        notify('error', task.message || 'Workspace download failed.');
      }
    }
  }, [tasks, pendingDownloads, authHeaders]);

  const handleRefreshFiles = async () => {
    setRefreshingFiles(true);
    try {
      await refetchFiles();
      notify('success', 'File list refreshed.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to refresh file list.');
    } finally {
      setRefreshingFiles(false);
    }
  };

  const handleLdacaImport = async () => {
    if (!ldacaUrl.trim()) return;
    
    setLdacaImporting(true);
    try {
      const response = await filesApi.importLdaca(ldacaUrl, authHeaders);

      notify('success', response.message || 'LDaCA import started in background.');
      setLdacaUrl('');
      setLdacaImportOpen(false);
      await refetchFiles();
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to start LDaCA import.');
    } finally {
      setLdacaImporting(false);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
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
  };

  const handleAddToWorkspace = async () => {
    if (!addFileName) return;
    try {
      await workspaceActions.createNodeFromFile(addFileName);
      notify('success', `${addFileName} added to workspace.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to add file to workspace.');
    } finally {
      setAddFileName(null);
    }
  };

  const workspaceFolder = fileListResponse?.user_folder || dataFolder || 'data/';
  const workspaceBusy = isLoading.workspaces || isLoading.currentWorkspace;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">Data Loader</h1>
          <HelpIcon
            targetKey="data-loader.tab"
            label="Data loader overview"
            tooltip="Manage workspaces, upload text data, and add files to the active workspace. Use this tab before running downstream analyses."
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card ref={activeCardRef}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Active workspace
              <HelpIcon
                targetKey="data-loader.active-workspace.section"
                label="Active workspace overview"
                tooltip="Choose or rename the workspace where new nodes will be added. Save regularly to persist your progress."
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentWorkspace ? (
              <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                  {currentWorkspace.name}
                  <Badge>{nodeCount} nodes</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Updated {formatTimestamp(currentWorkspace.modified_at || currentWorkspace.updated_at)} | Size {formatBytes(Number(currentWorkspace.workspace_size_Byte || 0))} | Created {formatTimestamp(currentWorkspace.created_at)}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-muted-foreground/50 px-4 py-3 text-sm text-muted-foreground">
                No workspace selected. Pick one below or create a new workspace.
              </div>
            )}

            {hasWorkspaceSelected && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="rename-workspace">Rename workspace</Label>
                  <HelpIcon targetKey="data-loader.rename-workspace.input" label="Rename workspace input" />
                </div>
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

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={handleSaveWorkspace} disabled={!hasWorkspaceSelected}>
                <RefreshCcw className="mr-2 h-4 w-4" /> Save
              </Button>
              <div className="flex items-center gap-1">
                <Button variant="outline" onClick={handleSaveWorkspaceAs} disabled={!hasWorkspaceSelected}>
                  <FolderPlus className="mr-2 h-4 w-4" /> Save as…
                </Button>
                <HelpIcon targetKey="data-loader.save-as.button" label="Save workspace as" />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  onClick={() => workspaceActions.setCurrentWorkspace(null)}
                  disabled={!hasWorkspaceSelected || workspaceBusy}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Unload
                </Button>
                <HelpIcon targetKey="data-loader.unload.button" label="Unload workspace" />
              </div>
            </div>

            {!hasWorkspaceSelected && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="new-workspace-name">Create workspace</Label>
                  <HelpIcon targetKey="data-loader.create-workspace.name" label="Workspace name input" />
                </div>
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
                <div className="flex items-center gap-2">
                  <Button onClick={handleCreateWorkspace} disabled={!newWorkspaceName.trim()}>
                    <Plus className="mr-2 h-4 w-4" /> Create workspace
                  </Button>
                  <HelpIcon targetKey="data-loader.create-workspace.button" label="Create workspace" />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className="flex flex-col overflow-hidden"
          style={activeCardHeight ? { height: activeCardHeight } : undefined}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                Workspace manager
                <HelpIcon
                  targetKey="data-loader.workspace-manager.section"
                  label="Workspace manager overview"
                  tooltip="Switch between saved workspaces or remove ones you no longer need."
                />
              </CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={openWorkspaceZipPicker}
                  disabled={uploadingWorkspaceZip || workspaceBusy}
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  {uploadingWorkspaceZip ? 'Uploading…' : 'Upload workspace'}
                </Button>
                <input
                  ref={workspaceZipInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={handleWorkspaceZipInputChange}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Refresh workspace list"
                  title="Refresh workspace list"
                  onClick={handleRefreshWorkspaces}
                  disabled={refreshingWorkspaces || workspaceBusy}
                >
                  <RefreshCcw className={`h-4 w-4 ${refreshingWorkspaces ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col min-h-0 overflow-hidden">
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
                          Updated {formatTimestamp(workspace.modified_at || workspace.updated_at)} | {workspace.dataframe_count ?? workspace.node_count ?? 0} nodes | Size {formatBytes(Number(workspace.workspace_size_Byte || 0))}
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
                          variant="outline"
                          onClick={() => handleDownloadWorkspaceZip(workspaceId, workspace.name || workspaceId)}
                          disabled={downloadingWorkspaceId === workspaceId || Boolean(pendingDownloads[workspaceId])}
                        >
                          <DownloadIcon className="mr-1.5 h-4 w-4" />
                          {pendingDownloads[workspaceId] ? 'Preparing…' : downloadingWorkspaceId === workspaceId ? 'Starting…' : 'Download'}
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
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              Files & uploads
              <HelpIcon
                targetKey="data-loader.files.section"
                label="Files and uploads section"
                tooltip="Upload CSV, TSV, Excel, or JSON files, preview them, and add them to the active workspace."
              />
            </CardTitle>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh file list"
              title="Refresh file list"
              onClick={handleRefreshFiles}
              disabled={refreshingFiles || loadingFiles}
            >
              <RefreshCcw className={`h-4 w-4 ${refreshingFiles ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button onClick={openFilePicker} disabled={uploading}>
                <Upload className="mr-2 h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload file'}
              </Button>
              <HelpIcon targetKey="data-loader.upload.button" label="Upload file" />
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" onClick={handleImportSampleData} disabled={importingSamples}>
                <FolderPlus className="mr-2 h-4 w-4" /> {importingSamples ? 'Importing…' : 'Import sample data'}
              </Button>
              <HelpIcon targetKey="data-loader.import-sample.button" label="Import sample data" />
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" onClick={() => setLdacaImportOpen(true)} disabled={ldacaImporting}>
                <DownloadIcon className="mr-2 h-4 w-4" /> Import from LDaCA
              </Button>
              <HelpIcon targetKey="data-loader.import-ldaca.button" label="Import from LDaCA" />
            </div>
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
                    <TableHead>
                      <span className="inline-flex items-center gap-1">
                        Actions
                        <HelpIcon targetKey="data-loader.add.button" label="Add file to workspace" />
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedFiles.map((file) => (
                    <TableRow key={file.filename} className={selectedFile === file.filename ? 'bg-muted/50' : undefined}>
                      <TableCell>
                        <div className="flex items-center gap-1.5 font-medium text-foreground">
                          <span>{file.display_name || file.filename}</span>
                          {Boolean(file.readme?.trim()) && (file.display_name || '').toLowerCase() !== 'readme.md' && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              aria-label={`View citation for ${file.display_name || file.filename}`}
                              title="View citation"
                              onClick={() => setCitationFile(file)}
                            >
                              <Quote className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
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
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>Total files: {sortedFiles.length}</div>
        </div>
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

      <AlertDialog open={Boolean(workspaceNameAlert)} onOpenChange={(open: boolean) => !open && setWorkspaceNameAlert(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid workspace name</AlertDialogTitle>
            <AlertDialogDescription>
              {workspaceNameAlert || 'Workspace names cannot include path separators or traversal sequences.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setWorkspaceNameAlert(null)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(workspaceToDelete)} onOpenChange={(open: boolean) => !open && setWorkspaceToDelete(null)}>
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
      
      <Dialog open={ldacaImportOpen} onOpenChange={setLdacaImportOpen}>
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
                value={ldacaUrl}
                onChange={(e) => setLdacaUrl(e.target.value)}
                placeholder="https://data.ldaca.edu.au/..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLdacaImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleLdacaImport} disabled={ldacaImporting || !ldacaUrl.trim()}>
              {ldacaImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(citationFile)} onOpenChange={(open) => !open && setCitationFile(null)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Citation</DialogTitle>
            <DialogDescription>
              {citationFile ? `Source: ${citationFile.folder || '(root)'} / README.md` : 'Citation metadata'}
            </DialogDescription>
          </DialogHeader>
          {citationFile?.readme ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{citationFile.readme}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No citation available for this file.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DataLoaderFeature;
