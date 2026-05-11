import React, { useCallback, useRef, useState } from 'react';
import { Loader2, FolderPlus, Upload, Download as DownloadIcon, RefreshCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceActions } from '@/features/workspace/common/hooks/useWorkspaceActions';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useAuth } from '@/hooks/useAuth';
import { useFiles } from '@/hooks/useFiles';
import { queryKeys } from '@/lib/queryKeys';
import { filesApi } from '@/api/files';
import { workspacesApi } from '@/api/workspaces';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useUIStore } from '@/stores/uiStore';
import { type FileTreeDirectory } from '@/types';
import { AddFilePanel, FilePreviewPanel } from '@/components/panels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { getInvalidWorkspaceNameMessage } from '@/features/workspace/common/workspaceName';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { usePendingWorkspaceDownloads } from './hooks/usePendingWorkspaceDownloads';
import { FileTree } from './components/FileTree';
import { WorkspaceManagerCard } from './components/WorkspaceManagerCard';
import { ActiveWorkspaceCard } from './components/ActiveWorkspaceCard';
import { DataLoaderDialogs } from './components/DataLoaderDialogs';
import { countFilesInNode } from './utils/fileTreeHelpers';
import { getWorkspaceId } from './utils/format';

const MAX_FILE_TREE_HEIGHT_REM = 40;

export const DataLoaderFeature: React.FC = () => {
  const queryClient = useQueryClient();
  const { workspaces, currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const workspaceActions = useWorkspaceActions();
  const { isLoading } = useWorkspaceStatus();
  const { dataFolder, getAuthHeaders } = useAuth({ autoStart: true, debugLabel: 'DataLoaderFeature' });
  const authHeaders = getAuthHeaders();

  const {
    fileTree,
    selectedFile,
    setSelectedFile,
    loadingFiles,
    uploading,
    handleUploadFile,
    handleDeleteFile,
    handleDownloadFile,
    refetchFiles,
  } = useFiles({ authHeaders });

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
  const [citationDirectory, setCitationDirectory] = useState<FileTreeDirectory | null>(null);
  const [citationPath, setCitationPath] = useState<string | null>(null);
  const [citationContent, setCitationContent] = useState<string | null>(null);
  const [citationLoading, setCitationLoading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderParentPath, setCreateFolderParentPath] = useState('');
  const [createFolderParentLabel, setCreateFolderParentLabel] = useState('root');
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderNameAlert, setFolderNameAlert] = useState<string | null>(null);
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false);
  const [refreshingFiles, setRefreshingFiles] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [isFileDropActive, setIsFileDropActive] = useState(false);
  const [uploadingWorkspaceZip, setUploadingWorkspaceZip] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    containerRef: splitContainerRef,
    value: topRatio,
    splitterProps,
  } = useResizableSplit({ defaultValue: 0.4 });
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

  const workspaceDownloads = usePendingWorkspaceDownloads({ authHeaders, notify });

  const favoriteWorkspaces = usePreferencesStore((state) => state.favoriteWorkspaces);

  const sortedWorkspaces = workspaces.toSorted((a, b) => {
    const aId = getWorkspaceId(a) ?? '';
    const bId = getWorkspaceId(b) ?? '';
    const aFav = favoriteWorkspaces.includes(aId) ? 1 : 0;
    const bFav = favoriteWorkspaces.includes(bId) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    const aTime = Date.parse(String(a?.modified_at || a?.updated_at || a?.created_at || ''));
    const bTime = Date.parse(String(b?.modified_at || b?.updated_at || b?.created_at || ''));
    return (bTime || 0) - (aTime || 0);
  });

  const totalFileCount = fileTree.reduce((sum, node) => sum + countFilesInNode(node), 0);

  const currentWorkspace = workspaces.find((ws) => getWorkspaceId(ws) === currentWorkspaceId) || null;

  const nodeCount =
    workspaceGraph?.nodes?.length ??
    currentWorkspace?.total_nodes ??
    currentWorkspace?.dataframe_count ??
    0;

  const handleCreateWorkspace = async (name: string, description: string): Promise<boolean> => {
    if (!name) return false;
    try {
      await workspaceActions.createWorkspace(name, description || undefined);
      notify('success', `Workspace "${name}" created.`);
      return true;
    } catch (error) {
      const message = getInvalidWorkspaceNameMessage(error);
      if (message) {
        setWorkspaceNameAlert(message);
        return false;
      }
      notify('error', (error as Error).message || 'Failed to create workspace.');
      return false;
    }
  };

  const handleRenameWorkspace = async (value: string) => {
    try {
      await workspaceActions.renameWorkspace(value);
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

  const handleSetCurrentWorkspace = async (workspaceId: string | null) => {
    try {
      await workspaceActions.setCurrentWorkspace(workspaceId);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to update active workspace.');
    }
  };

  const handleUpdateWorkspaceDescription = async (value: string) => {
    try {
      await workspaceActions.updateWorkspaceDescription(value);
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

  const handleUploadWorkspaceZip = async (file: File) => {
    setUploadingWorkspaceZip(true);
    try {
      await workspacesApi.uploadZip(file, authHeaders);
      await queryClient.refetchQueries({ queryKey: queryKeys.workspaces, exact: true });
      notify('success', `Workspace ZIP "${file.name}" uploaded.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to upload workspace ZIP.');
    } finally {
      setUploadingWorkspaceZip(false);
    }
  };

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

  const openCreateFolderDialog = (parentPath: string, parentLabel: string) => {
    setCreateFolderParentPath(parentPath);
    setCreateFolderParentLabel(parentLabel);
    setNewFolderName('');
    setFolderNameAlert(null);
    setCreateFolderOpen(true);
  };

  const handleCreateFolder = async () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      return;
    }

    setCreatingFolder(true);
    try {
      await filesApi.createFolder(createFolderParentPath, trimmedName, authHeaders);
      await refetchFiles();
      notify('success', `Folder "${trimmedName}" created.`);
      setCreateFolderOpen(false);
      setNewFolderName('');
    } catch (error) {
      const message = (error as { message?: string })?.message || 'Failed to create folder.';
      if (message.toLowerCase().includes('invalid folder name')) {
        setFolderNameAlert(message);
        return;
      }
      notify('error', message);
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleMoveFile = async (sourcePath: string, targetDirectoryPath: string) => {
    try {
      await filesApi.moveFile(sourcePath, targetDirectoryPath, authHeaders);
      await refetchFiles();
      notify('success', `Moved ${sourcePath.split('/').at(-1)}.`);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to move file.');
    }
  };

  const openCitation = async (directory: FileTreeDirectory, readmePath: string | null) => {
    if (!readmePath) {
      setCitationDirectory(directory);
      setCitationPath(null);
      setCitationContent(null);
      return;
    }

    setCitationDirectory(directory);
    setCitationPath(readmePath);
    setCitationContent(null);
    setCitationLoading(true);
    try {
      const rawContent = await filesApi.raw(readmePath, authHeaders);
      setCitationContent(rawContent);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to load citation.');
    } finally {
      setCitationLoading(false);
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const uploadSelectedFiles = async (filesToUpload: FileList | File[] | null | undefined) => {
    const selectedFiles = Array.from(filesToUpload ?? []);
    if (selectedFiles.length === 0) {
      return;
    }

    setUploadingFiles(true);
    let uploadedCount = 0;
    const failedFiles: string[] = [];
    const setLastUploadedFilePath = useUIStore.getState().setLastUploadedFilePath;
    let lastSuccess: string | null = null;

    try {
      for (const file of selectedFiles) {
        try {
          const success = await handleUploadFile(file);
          if (success) {
            uploadedCount += 1;
            lastSuccess = file.name;
          } else {
            failedFiles.push(file.name);
          }
        } catch {
          failedFiles.push(file.name);
        }
      }

      if (lastSuccess) {
        // Server stores uploads at the data-folder root, so the visible path
        // matches the file's basename. Used by the contextual hints system
        // to highlight the matching file row's "Add" button.
        setLastUploadedFilePath(lastSuccess);
      }

      if (failedFiles.length === 0) {
        if (uploadedCount === 1) {
          notify('success', `Uploaded ${selectedFiles[0]?.name}.`);
        } else {
          notify('success', `Uploaded ${uploadedCount} files.`);
        }
        return;
      }

      if (uploadedCount === 0) {
        notify('error', `Failed to upload ${failedFiles.length === 1 ? failedFiles[0] : `${failedFiles.length} files`}.`);
        return;
      }

      notify('error', `Uploaded ${uploadedCount} of ${selectedFiles.length} files. Failed: ${failedFiles.join(', ')}.`);
    } finally {
      setUploadingFiles(false);
    }
  };

  const isFileDrag = (event: React.DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files');
  };

  const handleFileAreaDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsFileDropActive(true);
  };

  const handleFileAreaDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setIsFileDropActive(false);
  };

  const handleFileAreaDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(event)) {
      return;
    }

    event.preventDefault();
    setIsFileDropActive(false);
    await uploadSelectedFiles(event.dataTransfer.files);
  };

  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      await uploadSelectedFiles(event.target.files);
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
      // The file has been added — clear the "new upload" hint state so the
      // contextual hint stops pointing at this row.
      const lastUploaded = useUIStore.getState().lastUploadedFilePath;
      if (lastUploaded && (lastUploaded === addFileName || addFileName.endsWith(`/${lastUploaded}`))) {
        useUIStore.getState().setLastUploadedFilePath(null);
      }
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to add file to workspace.');
    } finally {
      setAddFileName(null);
    }
  };

  const workspaceFolder = dataFolder || 'data/';
  const workspaceBusy = isLoading.workspaces || isLoading.currentWorkspace;

  return (
    <div className="flex h-[calc(100vh-9rem)] min-h-[640px] flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold leading-none tracking-tight text-foreground">Data Loader</h1>
          <InfoIcon
            targetKey="data-loader.overview"
            label="About the Data Loader"
            tooltip="Learn what the Data Loader is and how it helps you get started."
          />
          <HelpIcon
            targetKey="data-loader.tab"
            label="Data loader overview"
            tooltip="Manage workspaces, upload text data, and add files to the active workspace. Use this tab before running downstream analyses."
          />
        </div>
      </div>

      <div ref={splitContainerRef} className="flex min-h-0 flex-1 flex-col">
        <div
          className="min-h-0 overflow-hidden"
          style={{ flexBasis: `${topRatio * 100}%` }}
        >
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-2">
            <ActiveWorkspaceCard
              currentWorkspace={currentWorkspace}
              nodeCount={nodeCount}
              busy={workspaceBusy}
              onCreate={handleCreateWorkspace}
              onRename={handleRenameWorkspace}
              onUpdateDescription={handleUpdateWorkspaceDescription}
              onSave={handleSaveWorkspace}
              onUnload={() => handleSetCurrentWorkspace(null)}
            />

        <WorkspaceManagerCard
          workspaces={sortedWorkspaces}
          currentWorkspaceId={currentWorkspaceId}
          busy={workspaceBusy}
          uploadingZip={uploadingWorkspaceZip}
          refreshing={refreshingWorkspaces}
          downloads={workspaceDownloads}
          onUploadZip={handleUploadWorkspaceZip}
          onRefresh={() => void handleRefreshWorkspaces()}
          onLoadWorkspace={(workspaceId) => void handleSetCurrentWorkspace(workspaceId)}
          onDeleteWorkspace={openDeleteWorkspaceDialog}
        />
          </div>
        </div>

        <div
          {...splitterProps}
          aria-label="Resize data loader sections"
          className="my-1 flex h-2 shrink-0 cursor-row-resize items-center justify-center rounded-full bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title="Drag to resize. Double-click to reset."
        >
          <div className="h-1 w-12 rounded-full bg-muted-foreground/40" />
        </div>

        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ flexBasis: `${(1 - topRatio) * 100}%` }}
        >
          <Card className="flex h-full flex-col overflow-hidden">
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
        <CardContent className="flex-1 min-h-0 overflow-y-auto space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button onClick={openFilePicker} disabled={uploading || uploadingFiles}>
                <Upload className="mr-2 h-4 w-4" /> {uploading || uploadingFiles ? 'Uploading…' : 'Upload files'}
              </Button>
              <HelpIcon targetKey="data-loader.upload.button" label="Upload files" />
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
              aria-label="Upload files"
              className="hidden"
              multiple
              onChange={handleFileInputChange}
            />
            <div className="text-xs text-muted-foreground">
              Stored under <span className="font-mono">{workspaceFolder}</span>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Drag multiple files into the file list to upload them, or use Upload files to select several at once.
          </div>

          <div
            role="region"
            aria-label="Files upload area"
            onDragEnter={handleFileAreaDragOver}
            onDragOver={handleFileAreaDragOver}
            onDragLeave={handleFileAreaDragLeave}
            onDrop={handleFileAreaDrop}
            className={`rounded-md transition-colors ${isFileDropActive ? 'border border-primary bg-primary/5 ring-2 ring-primary/20' : ''}`}
          >
            {loadingFiles ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
              </div>
            ) : totalFileCount === 0 ? (
              <div className={`overflow-hidden rounded-md border ${isFileDropActive ? 'border-primary text-foreground' : 'border-dashed border-muted-foreground/60 text-muted-foreground'}`}>
                <div className="flex items-center justify-start border-b border-border/60 px-2 py-1.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => openCreateFolderDialog('', 'root')}
                    disabled={creatingFolder}
                    aria-label="Add root folder"
                    title="Add root folder"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="px-4 py-3 text-sm">
                  {isFileDropActive ? 'Drop files here to upload them.' : 'No files found. Upload a dataset to begin.'}
                </div>
              </div>
            ) : (
              <div className={`overflow-hidden rounded-md border ${isFileDropActive ? 'border-primary' : ''}`}>
                <div className="flex items-center justify-start border-b border-border/60 px-2 py-1.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => openCreateFolderDialog('', 'root')}
                    disabled={creatingFolder}
                    aria-label="Add root folder"
                    title="Add root folder"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <ScrollArea
                  className="w-full"
                  style={{ maxHeight: `${MAX_FILE_TREE_HEIGHT_REM}rem` }}
                >
                  <div className="flex flex-col gap-0.5 p-2">
                    <FileTree
                      nodes={fileTree}
                      selectedFile={selectedFile}
                      loadingFiles={loadingFiles}
                      hasWorkspaceSelected={hasWorkspaceSelected}
                      onPreviewFile={setPreviewFile}
                      onAddFile={setAddFileName}
                      onSelectFile={setSelectedFile}
                      onDownloadFile={handleDownloadFile}
                      onDeleteFile={handleDeleteFile}
                      onWarnNoWorkspace={() => setWorkspaceAlertOpen(true)}
                      onCreateFolderInside={openCreateFolderDialog}
                      onOpenCitation={openCitation}
                      onMoveFile={handleMoveFile}
                    />
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-4 text-xs text-muted-foreground">
          <div>Total files: {totalFileCount}</div>
        </div>
      </Card>
        </div>
      </div>

      <FilePreviewPanel filename={previewFile} open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} />
      <AddFilePanel
        filename={addFileName}
        open={Boolean(addFileName)}
        onClose={() => setAddFileName(null)}
        onConfirm={handleAddToWorkspace}
      />
      <DataLoaderDialogs
        noWorkspaceAlert={{
          open: workspaceAlertOpen,
          onClose: () => setWorkspaceAlertOpen(false),
        }}
        workspaceNameAlert={{
          message: workspaceNameAlert,
          onClose: () => setWorkspaceNameAlert(null),
        }}
        folderNameAlert={{
          message: folderNameAlert,
          onClose: () => setFolderNameAlert(null),
        }}
        deleteWorkspace={{
          target: workspaceToDelete,
          deleting: deletingWorkspace,
          onCancel: () => setWorkspaceToDelete(null),
          onConfirm: () => void handleConfirmDeleteWorkspace(),
        }}
        ldacaImport={{
          open: ldacaImportOpen,
          onOpenChange: setLdacaImportOpen,
          url: ldacaUrl,
          onUrlChange: setLdacaUrl,
          importing: ldacaImporting,
          onImport: () => void handleLdacaImport(),
        }}
        createFolder={{
          open: createFolderOpen,
          onOpenChange: setCreateFolderOpen,
          parentPath: createFolderParentPath,
          parentLabel: createFolderParentLabel,
          name: newFolderName,
          onNameChange: setNewFolderName,
          creating: creatingFolder,
          onCreate: () => void handleCreateFolder(),
        }}
        citation={{
          directory: citationDirectory,
          path: citationPath,
          content: citationContent,
          loading: citationLoading,
          onClose: () => {
            setCitationDirectory(null);
            setCitationPath(null);
            setCitationContent(null);
            setCitationLoading(false);
          },
        }}
      />
    </div>
  );
};

export default DataLoaderFeature;
