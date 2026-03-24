import React, { useEffect, useRef, useState } from 'react';
import { Loader2, FolderPlus, Upload, Trash2, Eye, Download as DownloadIcon, Plus, RefreshCcw, LogOut, Quote, ChevronRightIcon, FileIcon, FolderIcon, MoreHorizontal } from 'lucide-react';
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
import { useAnalysisStore, type TaskItem } from '../../../stores/analysisStore';
import { type FileInfo } from '../../../types';
import { AddFilePanel, FilePreviewPanel } from '../../../components/panels';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Badge } from '../../../components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../components/ui/collapsible';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
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

const getWorkspaceId = (workspace: { id?: string; unique_id?: string }): string | null => {
  const id = workspace?.id;
  const uniqueId = workspace?.unique_id;
  if (typeof id === 'string' && id) return id;
  if (typeof uniqueId === 'string' && uniqueId) return uniqueId;
  return null;
};

type FileTreeFolder = { name: string; path: string; children: FileTreeNode[] };
type FileTreeFile = { file: FileInfo };
type FileTreeNode = FileTreeFolder | FileTreeFile;

function buildFileTree(files: FileInfo[]): FileTreeNode[] {
  const folderMap = new Map<string, FileInfo[]>();
  const rootFiles: FileInfo[] = [];

  for (const file of files) {
    const folder = file.folder?.trim();
    if (folder) {
      const existing = folderMap.get(folder);
      if (existing) {
        existing.push(file);
      } else {
        folderMap.set(folder, [file]);
      }
    } else {
      rootFiles.push(file);
    }
  }

  // Build nested folder structure from paths like "sample_data/ADO"
  const root: FileTreeNode[] = [];
  const folderNodes = new Map<string, FileTreeFolder>();

  const getOrCreateFolder = (path: string): FileTreeFolder => {
    const existing = folderNodes.get(path);
    if (existing) return existing;

    const parts = path.split('/');
    const name = parts[parts.length - 1];
    const node: FileTreeFolder = { name, path, children: [] };
    folderNodes.set(path, node);

    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = getOrCreateFolder(parentPath);
      parent.children.push(node);
    } else {
      root.push(node);
    }
    return node;
  };

  for (const [folderPath, folderFiles] of folderMap) {
    const folder = getOrCreateFolder(folderPath);
    for (const f of folderFiles.sort((a, b) => (a.display_name || a.filename).localeCompare(b.display_name || b.filename))) {
      folder.children.push({ file: f });
    }
  }

  for (const f of rootFiles.sort((a, b) => (a.display_name || a.filename).localeCompare(b.display_name || b.filename))) {
    root.push({ file: f });
  }

  // Sort root: folders first, then files
  root.sort((a, b) => {
    const aIsFolder = 'children' in a ? 0 : 1;
    const bIsFolder = 'children' in b ? 0 : 1;
    if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder;
    const aName = 'children' in a ? a.name : (a.file.display_name || a.file.filename);
    const bName = 'children' in b ? b.name : (b.file.display_name || b.file.filename);
    return aName.localeCompare(bName);
  });

  return root;
}

function countFilesInNode(node: FileTreeNode): number {
  if ('file' in node) return 1;
  return node.children.reduce((sum, child) => sum + countFilesInNode(child), 0);
}

const MAX_FILE_TREE_HEIGHT_REM = 40;

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
  const [descriptionValue, setDescriptionValue] = useState('');
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [addFileName, setAddFileName] = useState<string | null>(null);
  const [importingSamples, setImportingSamples] = useState(false);
  const [workspaceAlertOpen, setWorkspaceAlertOpen] = useState(false);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<{ id: string; name?: string | null } | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
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
    const active = workspaces.find((ws) => getWorkspaceId(ws) === currentWorkspaceId);
    if (active?.name) {
      setRenameValue(active.name);
    } else {
      setRenameValue('');
    }
    setDescriptionValue(active?.description || '');
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

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    const aTime = Date.parse(String(a?.modified_at || a?.updated_at || a?.created_at || ''));
    const bTime = Date.parse(String(b?.modified_at || b?.updated_at || b?.created_at || ''));
    return (bTime || 0) - (aTime || 0);
  });

  const sortedFiles = [...files].sort((a: FileInfo, b: FileInfo) => a.filename.localeCompare(b.filename));
  const fileTree = buildFileTree(sortedFiles);

  const currentWorkspace = workspaces.find((ws) => getWorkspaceId(ws) === currentWorkspaceId) || null;
  const normalizedCurrentDescription = (currentWorkspace?.description || '').trim();
  const normalizedDescriptionValue = descriptionValue.trim();

  const nodeCount =
    workspaceGraph?.nodes?.length ??
    currentWorkspace?.total_nodes ??
    currentWorkspace?.dataframe_count ??
    0;

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

  const handleUpdateWorkspaceDescription = async () => {
    try {
      await workspaceActions.updateWorkspaceDescription(descriptionValue.trim());
      notify('success', 'Workspace description updated.');
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to update workspace description.');
    }
  };

  const openDeleteWorkspaceDialog = (workspaceId: string) => {
    const target = workspaces.find((ws) => getWorkspaceId(ws) === workspaceId);
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
      const response = await workspacesApi.startDownloadTask(authHeaders);
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
          const { [workspaceId]: _, ...next } = prev;
          return next;
        });
        // Fetch the artifact and trigger browser download
        (async () => {
          try {
            const blob = await workspacesApi.downloadTaskArtifact(taskId, authHeaders);
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
          const { [workspaceId]: _, ...next } = prev;
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

  const handleAddToWorkspace = async (selectedSheet?: string | null) => {
    if (!addFileName) return;
    try {
      await workspaceActions.createNodeFromFile(addFileName, selectedSheet ?? undefined);
      notify('success', `${addFileName} added to workspace.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to add file to workspace.');
    } finally {
      setAddFileName(null);
    }
  };

  const workspaceFolder = fileListResponse?.user_folder || dataFolder || 'data/';
  const workspaceBusy = isLoading.workspaces || isLoading.currentWorkspace;

  const renderFileItem = (file: FileInfo) => (
    <div
      key={file.filename}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50 ${
        selectedFile === file.filename ? 'bg-muted/50' : ''
      }`}
    >
      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {file.display_name || file.filename}
            </span>
            {Boolean(file.readme?.trim()) && (file.display_name || '').toLowerCase() !== 'readme.md' && (
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`View citation for ${file.display_name || file.filename}`}
                title="View citation"
                onClick={() => setCitationFile(file)}
              >
                <Quote className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(file.size)}</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">{formatTimestamp(file.modified)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPreviewFile(file.filename)}>
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Preview</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
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
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Add</span>
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleDownloadFile(file.filename)}>
            <DownloadIcon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Download</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => handleDeleteFile(file.filename)}
            disabled={fileActionInFlight}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );

  const renderFileTreeNode = (node: FileTreeNode): React.ReactNode => {
    if ('file' in node) {
      return renderFileItem(node.file);
    }

    const fileCount = countFilesInNode(node);
    return (
      <Collapsible key={node.path} defaultOpen>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="group/folder w-full justify-start gap-1 transition-none hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronRightIcon className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]/folder:rotate-90" />
            <FolderIcon className="h-4 w-4 shrink-0" />
            <span className="truncate">{node.name}</span>
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {fileCount}
            </Badge>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-5">
          <div className="flex flex-col gap-0.5 border-l border-border/40 pl-2">
            {node.children.map((child) => renderFileTreeNode(child))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

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
                tooltip="Choose or rename the workspace where new data blocks will be added. Save regularly to persist your progress."
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentWorkspace ? (
              <>
                <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-foreground">
                    {currentWorkspace.name}
                    <Badge>{nodeCount} data block{nodeCount === 1 ? '' : 's'}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Updated {formatTimestamp(currentWorkspace.modified_at || currentWorkspace.updated_at)} | Size {formatBytes(Number(currentWorkspace.workspace_size_Byte || 0))} | Created {formatTimestamp(currentWorkspace.created_at)}
                  </div>
                </div>

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

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="workspace-description">Workspace description</Label>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="workspace-description"
                      aria-label="Workspace description"
                      value={descriptionValue}
                      onChange={(event) => setDescriptionValue(event.target.value)}
                      placeholder="Enter workspace description"
                      disabled={!hasWorkspaceSelected || workspaceBusy}
                    />
                    <Button
                      onClick={handleUpdateWorkspaceDescription}
                      disabled={!hasWorkspaceSelected || workspaceBusy || normalizedDescriptionValue === normalizedCurrentDescription}
                    >
                      Update description
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={handleSaveWorkspace} disabled={!hasWorkspaceSelected}>
                    <RefreshCcw className="mr-2 h-4 w-4" /> Save
                  </Button>
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
              </>
            ) : (
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
                {sortedWorkspaces.map((workspace) => {
                  const workspaceId = getWorkspaceId(workspace);
                  if (!workspaceId) return null;
                  const isActive = workspaceId === currentWorkspaceId;
                  return (
                    <div
                      key={workspaceId}
                      className={`flex flex-col gap-2 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                        isActive ? 'border-primary bg-primary/10 ring-1 ring-primary/20 shadow-sm' : 'border-border/70 bg-background'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1 font-medium text-foreground">
                          <span>{workspace.name || workspaceId}</span>
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                aria-label="View workspace description"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="max-w-xs">
                              <DropdownMenuLabel>Description</DropdownMenuLabel>
                              <div className="px-2 py-1.5 text-sm text-popover-foreground whitespace-pre-wrap">
                                {workspace.description?.trim() || 'No description added yet.'}
                              </div>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Updated {formatTimestamp(workspace.modified_at || workspace.updated_at)} | {workspace.total_nodes ?? workspace.dataframe_count ?? 0} data block{(workspace.total_nodes ?? workspace.dataframe_count ?? 0) === 1 ? '' : 's'} | Size {formatBytes(Number(workspace.workspace_size_Byte || 0))}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant={isActive ? 'outline' : 'secondary'}
                          onClick={() => workspaceActions.setCurrentWorkspace(isActive ? null : workspaceId)}
                        >
                          {isActive ? 'Unload' : 'Load'}
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
              <ScrollArea
                className="w-full"
                style={{ maxHeight: `${MAX_FILE_TREE_HEIGHT_REM}rem` }}
              >
                <div className="flex flex-col gap-0.5 p-2">
                  {fileTree.map((node) => renderFileTreeNode(node))}
                </div>
              </ScrollArea>
            </div>
          )}
        </CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4 text-xs text-muted-foreground">
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
