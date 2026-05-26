import React, { useCallback, useState } from 'react';
import { Loader2, FolderPlus, Upload, Download as DownloadIcon, RefreshCcw } from 'lucide-react';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useAuth } from '@/hooks/useAuth';
import { useFiles } from '@/hooks/useFiles';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useAnalysisStore, isRunningTaskState, isPendingTaskState } from '@/stores/analysisStore';
import { AddFilePanel, FilePreviewPanel } from '@/components/panels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { usePendingWorkspaceDownloads } from './hooks/usePendingWorkspaceDownloads';
import { useDataLoaderWorkspaceActions } from './hooks/useDataLoaderWorkspaceActions';
import { useFileBrowserActions } from './hooks/useFileBrowserActions';
import { useFolderCreation } from './hooks/useFolderCreation';
import { useLdacaImport } from './hooks/useLdacaImport';
import { useUploadState } from './hooks/useUploadState';
import { FileTree } from './components/FileTree';
import { WorkspaceManagerCard } from './components/WorkspaceManagerCard';
import { ActiveWorkspaceCard } from './components/ActiveWorkspaceCard';
import { DataLoaderDialogs } from './components/DataLoaderDialogs';
import { SampleDataPanel } from './components/SampleDataPanel';
import { countFilesInNode } from './utils/fileTreeHelpers';
import { getWorkspaceId } from './utils/format';

export const DataLoaderFeature: React.FC = () => {
  const { workspaces, currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();
  const { dataFolder, getAuthHeaders } = useAuth({ autoStart: true });
  const authHeaders = getAuthHeaders();
  const ldacaOniApiToken = usePreferencesStore((state) => state.ldacaOniApiToken);
  const setLdacaOniApiToken = usePreferencesStore((state) => state.setLdacaOniApiToken);

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
  const [workspaceAlertOpen, setWorkspaceAlertOpen] = useState(false);
  const {
    containerRef: splitContainerRef,
    value: topRatio,
    splitterProps,
  } = useResizableSplit({
    defaultValue: 0.4,
    persistKey: 'ldaca.layout.dataLoaderTopRatio',
  });
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
  const {
    workspaceToDelete,
    deletingWorkspace,
    workspaceNameAlert,
    refreshingWorkspaces,
    uploadingWorkspaceZip,
    closeWorkspaceNameAlert,
    closeDeleteWorkspaceDialog,
    handleCreateWorkspace,
    handleRenameWorkspace,
    handleSaveWorkspace,
    handleSetCurrentWorkspace,
    handleUpdateWorkspaceDescription,
    openDeleteWorkspaceDialog,
    handleConfirmDeleteWorkspace,
    handleRefreshWorkspaces,
    handleUploadWorkspaceZip,
    handleAddFileToWorkspace,
  } = useDataLoaderWorkspaceActions({
    workspaces,
    hasWorkspaceSelected,
    authHeaders,
    notify,
  });
  const {
    citationDirectory,
    citationPath,
    citationContent,
    citationLoading,
    refreshingFiles,
    handleRefreshFiles,
    handleMoveFile,
    openCitation,
    closeCitation,
  } = useFileBrowserActions({ authHeaders, refetchFiles, notify });
  const {
    ldacaImportOpen,
    setLdacaImportOpen,
    searchMethod,
    setSearchMethod,
    searchQuery,
    setSearchQuery,
    collectionFilter,
    setCollectionFilter,
    fileFormatFilter,
    setFileFormatFilter,
    featuredRecords,
    featuredLoading,
    searchResults,
    hasSearched,
    searching,
    importingId,
    ldacaImporting,
    errorMessage: ldacaErrorMessage,
    reloadFeaturedRecords,
    handleLdacaSearch,
    handleLdacaImport,
  } = useLdacaImport({ authHeaders, ldacaApiToken: ldacaOniApiToken, refetchFiles, notify });
  const {
    fileInputRef,
    uploadingFiles,
    isFileDropActive,
    openFilePicker,
    handleFileAreaDragOver,
    handleFileAreaDragLeave,
    handleFileAreaDrop,
    handleFileInputChange,
  } = useUploadState({ uploadFile: handleUploadFile, notify });
  const {
    createFolderOpen,
    setCreateFolderOpen,
    createFolderParentPath,
    createFolderParentLabel,
    newFolderName,
    setNewFolderName,
    creatingFolder,
    folderNameAlert,
    closeFolderNameAlert,
    openCreateFolderDialog,
    handleCreateFolder,
  } = useFolderCreation({ authHeaders, refetchFiles, notify });

  const favoriteWorkspaces = usePreferencesStore((state) => state.favoriteWorkspaces);

  const sortedWorkspaces = workspaces.toSorted((a, b) => {
    const aId = getWorkspaceId(a) ?? '';
    const bId = getWorkspaceId(b) ?? '';
    const aFav = favoriteWorkspaces.includes(aId) ? 1 : 0;
    const bFav = favoriteWorkspaces.includes(bId) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    const aTime = Date.parse(String(a?.modified_at || a?.created_at || ''));
    const bTime = Date.parse(String(b?.modified_at || b?.created_at || ''));
    return (bTime || 0) - (aTime || 0);
  });

  const totalFileCount = fileTree.reduce((sum, node) => sum + countFilesInNode(node), 0);

  const currentWorkspace =
    workspaces.find((ws) => getWorkspaceId(ws) === currentWorkspaceId) || null;

  const nodeCount =
    workspaceGraph?.nodes?.length ??
    currentWorkspace?.total_nodes ??
    0;

  const handleAddToWorkspace = async (selectedSheet?: string | null) => {
    if (!addFileName) return;
    try {
      await handleAddFileToWorkspace(addFileName, selectedSheet);
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to add file to workspace.');
    } finally {
      setAddFileName(null);
    }
  };

  const workspaceFolder = dataFolder || 'data/';
  const workspaceBusy = isLoading.workspaces || isLoading.currentWorkspace;
  // Block workspace switching/unloading while a task on the active workspace
  // is still running — switching while a materialisation is in flight has
  // corrupted the workspace state in past incidents.
  const tasks = useAnalysisStore((state) => state.tasks);
  const hasActiveTask = currentWorkspaceId
    ? tasks.some(
        (task) =>
          task.workspace_id === currentWorkspaceId &&
          (isRunningTaskState(task.state) || isPendingTaskState(task.state)),
      )
    : false;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-foreground leading-none font-semibold tracking-tight">Data Loader</h1>
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
        <div className="min-h-0 overflow-hidden" style={{ flexBasis: `${topRatio * 100}%` }}>
          <div className="grid h-full min-h-0 gap-4 lg:grid-cols-2">
            <ActiveWorkspaceCard
              currentWorkspace={currentWorkspace}
              nodeCount={nodeCount}
              busy={workspaceBusy}
              hasActiveTask={hasActiveTask}
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
              hasActiveTask={hasActiveTask}
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
          className="bg-border hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:ring-ring my-1 flex h-2 shrink-0 cursor-row-resize items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
          title="Drag to resize. Double-click to reset."
        >
          <div className="bg-muted-foreground/40 h-1 w-12 rounded-full" />
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
            <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <Button onClick={openFilePicker} disabled={uploading || uploadingFiles}>
                    <Upload className="mr-2 h-4 w-4" />{' '}
                    {uploading || uploadingFiles ? 'Uploading…' : 'Upload files'}
                  </Button>
                  <HelpIcon targetKey="data-loader.upload.button" label="Upload files" />
                </div>
                <div className="flex items-center gap-1">
                  <SampleDataPanel authHeaders={authHeaders} onImportComplete={refetchFiles} />
                  <HelpIcon
                    targetKey="data-loader.import-sample.button"
                    label="Import sample data"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    onClick={() => setLdacaImportOpen(true)}
                    disabled={ldacaImporting}
                  >
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
                <div className="text-muted-foreground text-xs">
                  Stored under <span className="font-mono">{workspaceFolder}</span>
                </div>
              </div>

              <div className="text-muted-foreground text-xs">
                Drag multiple files into the file list to upload them, or use Upload files to select
                several at once.
              </div>

              <div
                role="region"
                aria-label="Files upload area"
                onDragEnter={handleFileAreaDragOver}
                onDragOver={handleFileAreaDragOver}
                onDragLeave={handleFileAreaDragLeave}
                onDrop={handleFileAreaDrop}
                className={`flex min-h-0 flex-1 flex-col rounded-md transition-colors ${isFileDropActive ? 'border-primary bg-primary/5 ring-primary/20 border ring-2' : ''}`}
              >
                {loadingFiles ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
                  </div>
                ) : totalFileCount === 0 ? (
                  <div
                    className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border ${isFileDropActive ? 'border-primary text-foreground' : 'border-muted-foreground/60 text-muted-foreground border-dashed'}`}
                  >
                    <div className="border-border/60 flex items-center justify-start border-b px-2 py-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
                        onClick={() => openCreateFolderDialog('', 'root')}
                        disabled={creatingFolder}
                        aria-label="Add root folder"
                        title="Add root folder"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="flex flex-1 items-start px-4 py-3 text-sm">
                      {isFileDropActive
                        ? 'Drop files here to upload them.'
                        : 'No files found. Upload a dataset to begin.'}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border ${isFileDropActive ? 'border-primary' : ''}`}
                  >
                    <div className="border-border/60 flex items-center justify-start border-b px-2 py-1.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
                        onClick={() => openCreateFolderDialog('', 'root')}
                        disabled={creatingFolder}
                        aria-label="Add root folder"
                        title="Add root folder"
                      >
                        <FolderPlus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <ScrollArea className="min-h-0 flex-1">
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
              <div className="text-muted-foreground flex shrink-0 flex-wrap items-center justify-between gap-3 text-xs">
                <div>Total files: {totalFileCount}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <FilePreviewPanel
        filename={previewFile}
        open={Boolean(previewFile)}
        onClose={() => setPreviewFile(null)}
      />
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
          onClose: closeWorkspaceNameAlert,
        }}
        folderNameAlert={{
          message: folderNameAlert,
          onClose: closeFolderNameAlert,
        }}
        deleteWorkspace={{
          target: workspaceToDelete,
          deleting: deletingWorkspace,
          onCancel: closeDeleteWorkspaceDialog,
          onConfirm: () => void handleConfirmDeleteWorkspace(),
        }}
        ldacaImport={{
          open: ldacaImportOpen,
          onOpenChange: setLdacaImportOpen,
          searchMethod,
          onSearchMethodChange: setSearchMethod,
          query: searchQuery,
          onQueryChange: setSearchQuery,
          collectionFilter,
          onCollectionFilterChange: setCollectionFilter,
          fileFormatFilter,
          onFileFormatFilterChange: setFileFormatFilter,
          featuredRecords,
          featuredLoading,
          hasToken: Boolean(ldacaOniApiToken),
          searchResults,
          hasSearched,
          searching,
          importingId,
          importing: ldacaImporting,
          errorMessage: ldacaErrorMessage,
          onTokenSave: (token) => {
            const trimmed = token.trim();
            if (!trimmed) {
              notify('error', 'Enter a token before saving.');
              return;
            }
            setLdacaOniApiToken(trimmed);
            void reloadFeaturedRecords(trimmed);
            notify('success', 'LDaCA token saved.');
          },
          onTokenDelete: () => {
            setLdacaOniApiToken(null);
            void reloadFeaturedRecords(null);
            notify('success', 'LDaCA token deleted.');
          },
          onSearch: () => void handleLdacaSearch(),
          onImport: (recordId) => void handleLdacaImport(recordId),
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
          onClose: closeCitation,
        }}
      />
    </div>
  );
};

export default DataLoaderFeature;
