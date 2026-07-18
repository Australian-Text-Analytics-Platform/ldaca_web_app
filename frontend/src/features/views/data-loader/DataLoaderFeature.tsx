import { useState, type ReactNode } from 'react';
import { Loader2, FolderPlus, Upload, Download as DownloadIcon, RefreshCcw } from 'lucide-react';
import { useWorkspaceData } from '@/features/workspace/common/hooks/useWorkspaceData';
import { useWorkspaceStatus } from '@/features/workspace/common/hooks/useWorkspaceStatus';
import { useFiles } from '@/features/views/data-loader/hooks/useFiles';
import { useUserPreferences } from '@/features/preferences/useUserPreferences';
import { useAnalysisStore, isRunningTaskState, isPendingTaskState } from '@/stores/analysisStore';
import { AddFilePanel, FilePreviewPanel } from '@/features/views/data-loader/components';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import HelpIcon from '@/components/help/HelpIcon';
import InfoIcon from '@/components/help/InfoIcon';
import { useResizableSplit } from '@/hooks/useResizableSplit';
import { useWorkspaceDownloads } from '@/features/workspace/workspace-downloads/WorkspaceDownloadsContext';
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

interface FileListShellProps {
  children: ReactNode;
  creatingFolder: boolean;
  isDropActive: boolean;
  empty?: boolean;
  onCreateRootFolder: () => void;
}

/**
 * Shared frame for the Data Loader file list.
 *
 * Rendered by: DataLoaderFeature for both empty and populated file-list states
 * because those branches share the root-folder toolbar, bordered drop-state
 * styling, and scroll-constrained frame while keeping their actual body content
 * different.
 */
function FileListShell({
  children,
  creatingFolder,
  isDropActive,
  empty = false,
  onCreateRootFolder,
}: FileListShellProps) {
  let stateClasses = '';
  if (isDropActive) {
    stateClasses = empty ? 'border-primary text-foreground' : 'border-primary';
  } else if (empty) {
    stateClasses = 'border-muted-foreground/60 text-muted-foreground border-dashed';
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border ${stateClasses}`}
    >
      <div className="border-border/60 flex items-center justify-start border-b px-2 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="text-muted-foreground hover:text-foreground h-7 w-7 shrink-0"
          onClick={onCreateRootFolder}
          disabled={creatingFolder}
          aria-label="Add root folder"
          title="Add root folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {children}
    </div>
  );
}

/**
 * Orchestrates the Data Loader tab. It exists as the feature shell that wires
 * workspace actions, file browsing, uploads, sample imports, and dialogs for
 * the main app route.
 * Rendered by: ViewRouter when the user opens the Data Loader view because
 * this component is the only place that combines file-system state, workspace
 * mutations, upload/import hooks, and the split-panel layout. DataLoaderFeature
 * tests render it to verify those integrated workflows stay connected, while
 * AddFilePanel receives callbacks from it so individual selected files can be
 * promoted into workspace nodes.
 * Flow: collect workspace/auth/file-browser state, build notification and
 * mutation hooks, derive workspace/file summary values, block unsafe workspace
 * changes while tasks are active, then render the workspace, file tree, sample
 * data, preview, and dialog panels with the handlers they need.
 */
function DataLoaderFeature() {
  const { workspaces, currentWorkspaceId, workspaceGraph } = useWorkspaceData();
  const { isLoading } = useWorkspaceStatus();

  const {
    fileTree,
    selectedFile,
    setSelectedFile,
    loadingFiles,
    uploading,
    handleUploadFile,
    handleDeleteFile,
    handleDownloadFile,
    refreshFiles,
  } = useFiles();

  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [addFileName, setAddFileName] = useState<string | null>(null);
  const {
    containerRef: splitContainerRef,
    value: topRatio,
    splitterProps,
  } = useResizableSplit({
    defaultValue: 0.4,
    persistKey: 'ldaca.layout.dataLoaderTopRatio',
  });
  const hasWorkspaceSelected = Boolean(currentWorkspaceId);

  /**
   * Called by: Data Loader hooks when long-running file, workspace, import, or
   * folder actions need consistent user feedback. They call through this local
   * adapter so durations and Sonner entry points stay centralized instead of
   * each hook choosing its own toast behavior.
   * Flow: choose an error-specific or normal duration, map the semantic status
   * to the matching Sonner API, and fall back to the neutral toast for info.
   */
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

  const workspaceDownloads = useWorkspaceDownloads();
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
  } = useFileBrowserActions({ refreshFiles, notify });
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
    handleLdacaSearch,
    handleLdacaImport,
  } = useLdacaImport({ notify });
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
  } = useFolderCreation({ notify });

  const { preferences } = useUserPreferences();
  const favoriteWorkspaces = preferences.favorite_workspaces ?? [];

  const sortedWorkspaces = workspaces.toSorted((a, b) => {
    const aId = a.id;
    const bId = b.id;
    const aFav = favoriteWorkspaces.includes(aId) ? 1 : 0;
    const bFav = favoriteWorkspaces.includes(bId) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    // modified_at/created_at may be '' and must fall through to the next timestamp source

    const aTime = Date.parse(a.modified_at || a.created_at || '');

    const bTime = Date.parse(b.modified_at || b.created_at || '');
    return (bTime || 0) - (aTime || 0);
  });

  const totalFileCount = fileTree.reduce((sum, node) => sum + countFilesInNode(node), 0);

  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;

  const nodeCount = workspaceGraph?.nodes.length ?? currentWorkspace?.total_nodes ?? 0;

  /**
   * Bridges the add-file dialog to workspace node creation. The AddFilePanel
   * calls this after optional sheet selection, and the feature owns clearing
   * the pending filename afterward.
   * Called by: AddFilePanel's submit path because the sheet chooser only knows
   * the selected worksheet; DataLoaderFeature holds the pending filename and the
   * workspace mutation hook needed to create the node.
   * Flow: ignore submits with no pending filename, delegate node creation to the
   * workspace action hook, report any failure through the feature toast adapter,
   * then clear the pending filename so the dialog cannot resubmit stale state.
   */
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
        <div
          className="min-h-0 overflow-hidden"
          style={{ flexBasis: `${String(topRatio * 100)}%` }}
        >
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
          className="group focus-visible:ring-ring my-2 flex h-3 shrink-0 cursor-row-resize items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
          title="Drag to resize. Double-click to reset."
        >
          <div className="bg-muted-foreground/30 group-hover:bg-primary/50 group-focus-visible:bg-primary/50 h-1 w-12 rounded-full transition-colors" />
        </div>

        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ flexBasis: `${String((1 - topRatio) * 100)}%` }}
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
                  onClick={() => {
                    void handleRefreshFiles();
                  }}
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
                  <HelpIcon targetKey="data-loader.upload.button" label="About upload files" />
                </div>
                <div className="flex items-center gap-1">
                  <SampleDataPanel />
                  <HelpIcon
                    targetKey="data-loader.import-sample.button"
                    label="About import sample data"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setLdacaImportOpen(true);
                    }}
                    disabled={ldacaImporting}
                  >
                    <DownloadIcon className="mr-2 h-4 w-4" /> Import from LDaCA
                  </Button>
                  <HelpIcon
                    targetKey="data-loader.import-ldaca.button"
                    label="About import from LDaCA"
                  />
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  aria-label="Upload files"
                  className="hidden"
                  multiple
                  onChange={(e) => {
                    void handleFileInputChange(e);
                  }}
                />
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
                onDrop={(e) => {
                  void handleFileAreaDrop(e);
                }}
                className={`flex min-h-0 flex-1 flex-col rounded-md transition-colors ${isFileDropActive ? 'border-primary bg-primary/5 ring-primary/20 border ring-2' : ''}`}
              >
                {loadingFiles ? (
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
                  </div>
                ) : totalFileCount === 0 ? (
                  <FileListShell
                    creatingFolder={creatingFolder}
                    isDropActive={isFileDropActive}
                    empty
                    onCreateRootFolder={() => {
                      openCreateFolderDialog('', 'root');
                    }}
                  >
                    <div className="flex flex-1 items-start px-4 py-3 text-sm">
                      {isFileDropActive
                        ? 'Drop files here to upload them.'
                        : 'No files found. Upload a dataset to begin.'}
                    </div>
                  </FileListShell>
                ) : (
                  <FileListShell
                    creatingFolder={creatingFolder}
                    isDropActive={isFileDropActive}
                    onCreateRootFolder={() => {
                      openCreateFolderDialog('', 'root');
                    }}
                  >
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
                          onDownloadFile={(file) => {
                            void handleDownloadFile(file);
                          }}
                          onDeleteFile={(file) => {
                            void handleDeleteFile(file);
                          }}
                          onCreateFolderInside={openCreateFolderDialog}
                          onOpenCitation={(directory, readmePath) => {
                            void openCitation(directory, readmePath);
                          }}
                          onMoveFile={handleMoveFile}
                        />
                      </div>
                    </ScrollArea>
                  </FileListShell>
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
        /** Clears the selected preview file when the preview dialog closes. */
        onClose={() => {
          setPreviewFile(null);
        }}
      />
      <AddFilePanel
        filename={addFileName}
        open={Boolean(addFileName)}
        /** Clears the pending file-to-workspace selection when the add dialog closes. */
        onClose={() => {
          setAddFileName(null);
        }}
        onConfirm={handleAddToWorkspace}
      />
      <DataLoaderDialogs
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
          /**
           * Confirms the pending workspace delete from the presentation dialog.
           * Invoked by `DataLoaderDialogs` when workspace deletion is confirmed.
           */
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
          searchResults,
          hasSearched,
          searching,
          importingId,
          importing: ldacaImporting,
          errorMessage: ldacaErrorMessage,
          /**
           * Routes dialog search submission through the feature's guarded search handler.
           * Invoked by `DataLoaderDialogs` when its Oni search form submits.
           */
          onSearch: () => void handleLdacaSearch(),
          /**
           * Routes row-level imports through the feature's import task handler.
           * Invoked by `DataLoaderDialogs` from an Oni result/import action.
           */
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
          // The dialog only knows about form state; folder creation stays in
          // the hook so file-list refetch and alerts share one owner.
          // Invoked by DataLoaderDialogs when its create-folder form submits.
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
}

export default DataLoaderFeature;
