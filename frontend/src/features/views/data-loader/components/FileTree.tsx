import React, { useState } from 'react';
import {
  ChevronRightIcon,
  Download as DownloadIcon,
  Eye,
  FileIcon,
  FolderIcon,
  FolderPlus,
  Plus,
  Quote,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { FileTreeDirectory, FileTreeFile, FileTreeNode } from '@/features/views/data-loader/types';
import {
  FILE_DRAG_MIME_TYPE,
  countFilesInNode,
  getCitationFile,
  getParentDirectoryPath,
  getVisibleDirectoryChildren,
} from '../utils/fileTreeHelpers';
import { formatBytes } from '../utils/format';

type FileMoveTarget = {
  key: string;
  directoryPath: string;
};

export type FileTreeProps = {
  nodes: FileTreeNode[];
  selectedFile: string | null;
  loadingFiles: boolean;
  hasWorkspaceSelected: boolean;
  onPreviewFile: (path: string) => void;
  onAddFile: (path: string) => void;
  onSelectFile: (path: string) => void;
  onDownloadFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onWarnNoWorkspace: () => void;
  onCreateFolderInside: (parentPath: string, parentLabel: string) => void;
  onOpenCitation: (directory: FileTreeDirectory, readmePath: string | null) => void;
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => Promise<void> | void;
};

/**
 * Renders the nested file browser for uploaded data. `DataLoaderFeature` uses
 * it for preview/add/download/delete actions plus drag-to-move file handling.
 * Rendered by: useFileBrowserActions hook, DataLoaderFeature module, fileTreeHelpers utilities (rg call sites/imports) because the parent needs this component boundary to keep feature controls and state presentation isolated.
 * Flow: build rows from the browser tree, attach move/drop/create-folder handlers, and expose
 * add/preview/delete/download actions for selected files.
 */
export function FileTree({
  nodes,
  selectedFile,
  loadingFiles,
  hasWorkspaceSelected,
  onPreviewFile,
  onAddFile,
  onSelectFile,
  onDownloadFile,
  onDeleteFile,
  onWarnNoWorkspace,
  onCreateFolderInside,
  onOpenCitation,
  onMoveFile,
}: FileTreeProps) {
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const [fileMoveTarget, setFileMoveTarget] = useState<FileMoveTarget | null>(null);

  /**
   * Recovers the dragged file path from custom drag metadata with a local state
   * fallback for browsers that clear dataTransfer during nested drag events.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const getDraggedFilePath = (event: React.DragEvent<HTMLElement>): string | null => {
    const customPath = event.dataTransfer.getData(FILE_DRAG_MIME_TYPE);
    if (customPath) return customPath;
    const plainTextPath = event.dataTransfer.getData('text/plain');
    return plainTextPath || draggingFilePath;
  };

  /**
   * Blocks no-op moves into the file's current parent. Directory hover/drop
   * handlers use this before showing an active target or calling the API.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const canDropFileIntoDirectory = (
    sourcePath: string | null,
    targetDirectoryPath: string,
  ): boolean => {
    if (!sourcePath) return false;
    return getParentDirectoryPath(sourcePath) !== targetDirectoryPath;
  };

  /**
   * Drives drag styling for the exact directory/file-row target currently able
   * to receive the dragged file.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const isFileMoveTargetActive = (targetKey: string, targetDirectoryPath: string): boolean => {
    return (
      fileMoveTarget?.key === targetKey &&
      fileMoveTarget.directoryPath === targetDirectoryPath &&
      canDropFileIntoDirectory(draggingFilePath, targetDirectoryPath)
    );
  };

  /**
   * Seeds browser drag metadata for a file row. Row drag handles call this so
   * drop targets can recover the source path without prop drilling.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleTreeFileDragStart = (event: React.DragEvent<HTMLDivElement>, filePath: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(FILE_DRAG_MIME_TYPE, filePath);
    event.dataTransfer.setData('text/plain', filePath);
    setDraggingFilePath(filePath);
    setFileMoveTarget(null);
  };

  /**
   * Clears local drag bookkeeping after a file move attempt completes or is
   * cancelled by the browser.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleTreeFileDragEnd = () => {
    setDraggingFilePath(null);
    setFileMoveTarget(null);
  };

  /**
   * Marks a directory/file-row parent as a valid move destination while the
   * dragged file is over it.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleDirectoryDragOver = (
    targetKey: string,
    targetDirectoryPath: string,
    event: React.DragEvent<HTMLElement>,
  ) => {
    const sourcePath = getDraggedFilePath(event);
    if (!canDropFileIntoDirectory(sourcePath, targetDirectoryPath)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setFileMoveTarget({ key: targetKey, directoryPath: targetDirectoryPath });
  };

  /**
   * Removes move-target highlighting only when the drag leaves the whole row,
   * not when it moves between children inside the row.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleDirectoryDragLeave = (targetKey: string, event: React.DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setFileMoveTarget((current) => (current?.key === targetKey ? null : current));
  };

  /**
   * Completes a file move into the target directory. File and folder rows share
   * this drop path through the parent `onMoveFile` callback.
   * Called by: FileTree internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleDirectoryDrop = async (
    targetDirectoryPath: string,
    event: React.DragEvent<HTMLElement>,
  ) => {
    const sourcePath = getDraggedFilePath(event);
    if (!canDropFileIntoDirectory(sourcePath, targetDirectoryPath)) return;
    if (!sourcePath) return;
    event.preventDefault();
    setFileMoveTarget(null);
    setDraggingFilePath(null);
    await onMoveFile(sourcePath, targetDirectoryPath);
  };

  /**
   * Renders one file row with all file-level actions. `renderNode` delegates to
   * this so directory traversal and file action markup stay separate.
   * Rendered by: FileTree JSX render path because the parent needs this component boundary to keep feature controls and state presentation isolated.
   * Flow: derive file metadata/actions, attach drag payload and citation/download/delete
   * handlers, then render a row with add-to-workspace affordances.
   */
  const renderFileItem = (file: FileTreeFile, parentDirectoryPath: string) => (
    <div
      key={file.path}
      draggable
      data-file-path={file.path}
      data-testid={`file-row-${file.path}`}
      onDragStart={(event) => handleTreeFileDragStart(event, file.path)}
      onDragEnd={handleTreeFileDragEnd}
      onDragEnter={(event) =>
        handleDirectoryDragOver(`file:${file.path}`, parentDirectoryPath, event)
      }
      onDragOver={(event) =>
        handleDirectoryDragOver(`file:${file.path}`, parentDirectoryPath, event)
      }
      onDragLeave={(event) => handleDirectoryDragLeave(`file:${file.path}`, event)}
      onDrop={(event) => void handleDirectoryDrop(parentDirectoryPath, event)}
      className={`group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50 ${
        selectedFile === file.path ? 'bg-muted/50' : ''
      } ${
        isFileMoveTargetActive(`file:${file.path}`, parentDirectoryPath)
          ? 'bg-primary/10 ring-1 ring-primary/30'
          : ''
      }`}
    >
      <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{file.name}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(file.size)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onPreviewFile(file.path)}
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Preview</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            disabled={!hasWorkspaceSelected}
            data-hint-id="data-loader.file-row.add"
            onClick={() => {
              if (!hasWorkspaceSelected) {
                onWarnNoWorkspace();
                return;
              }
              onAddFile(file.path);
              onSelectFile(file.path);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Add</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => onDownloadFile(file.path)}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Download</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDeleteFile(file.path)}
            disabled={loadingFiles}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );

  /**
   * Recursively renders directories and files, hiding citation README files
   * from the main list while exposing their citation button on the folder row.
   * Rendered by: FileTree JSX render path because the parent needs this component boundary to keep feature controls and state presentation isolated.
   * Flow: split directory and file branches, render visible children recursively, and keep
   * folder/citation affordances beside the relevant tree row.
   */
  const renderNode = (node: FileTreeNode): React.ReactNode => {
    if (node.type === 'file') {
      return renderFileItem(node, getParentDirectoryPath(node.path));
    }
    const fileCount = countFilesInNode(node);
    const citationFile = getCitationFile(node);
    const visibleChildren = getVisibleDirectoryChildren(node);
    return (
      <Collapsible key={node.path} defaultOpen>
        <div
          className={`flex items-center gap-1 rounded-md pr-1 hover:bg-accent/50 ${
            isFileMoveTargetActive(`folder:${node.path}`, node.path)
              ? 'bg-primary/10 ring-1 ring-primary/30'
              : ''
          }`}
          data-folder-path={node.path}
          data-testid={`folder-row-${node.path}`}
          onDragEnter={(event) => handleDirectoryDragOver(`folder:${node.path}`, node.path, event)}
          onDragOver={(event) => handleDirectoryDragOver(`folder:${node.path}`, node.path, event)}
          onDragLeave={(event) => handleDirectoryDragLeave(`folder:${node.path}`, event)}
          onDrop={(event) => void handleDirectoryDrop(node.path, event)}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="group h-8 min-w-0 justify-start gap-1 px-2 transition-none hover:bg-transparent hover:text-accent-foreground"
              >
                <ChevronRightIcon className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                <FolderIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{node.name}</span>
              </Button>
            </CollapsibleTrigger>
            {citationFile ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label={`View citation for ${node.name}`}
                title="View citation"
                onClick={() => onOpenCitation(node, citationFile.path)}
              >
                <Quote className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={`Add folder inside ${node.name}`}
            title={`Add folder inside ${node.name}`}
            onClick={() => onCreateFolderInside(node.path, node.name)}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Badge variant="secondary" className="text-[10px]">
            {fileCount}
          </Badge>
        </div>
        <CollapsibleContent className="ml-5">
          <div className="flex flex-col gap-0.5 border-l border-border/40 pl-2">
            {visibleChildren.map((child) => renderNode(child))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return <>{nodes.map((node) => renderNode(node))}</>;
}
