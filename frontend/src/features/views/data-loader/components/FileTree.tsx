import React, { useEffect, useMemo, useState } from 'react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type {
  FileTreeDirectory,
  FileTreeFile,
  FileTreeNode,
} from '@/features/views/data-loader/types';
import {
  FILE_DRAG_MIME_TYPE,
  countFilesInNode,
  getCitationFile,
  getParentDirectoryPath,
  getVisibleDirectoryChildren,
} from '../utils/fileTreeHelpers';
import { formatBytes } from '../utils/format';
import { useAuth } from '@/features/auth/hooks/useAuth';

interface FileMoveTarget {
  key: string;
  directoryPath: string;
}

interface DeleteTarget {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

const directoryPathsIn = (nodes: FileTreeNode[]): string[] =>
  nodes.flatMap((node) =>
    node.type === 'directory' ? [node.path, ...directoryPathsIn(node.children)] : [],
  );

export interface FileTreeProps {
  nodes: FileTreeNode[];
  selectedFile: string | null;
  loadingFiles: boolean;
  hasWorkspaceSelected: boolean;
  workspaceId: string | null;
  onPreviewFile: (path: string) => void;
  onAddFile: (path: string) => void;
  onSelectFile: (path: string) => void;
  onDownloadFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onCreateFolderInside: (parentPath: string, parentLabel: string) => void;
  onOpenCitation: (directory: FileTreeDirectory, readmePath: string | null) => void;
  onMoveFile: (sourcePath: string, targetDirectoryPath: string) => Promise<void> | void;
}

interface FileTreeContentProps extends FileTreeProps {
  collapsedStorageKey: string;
}

/** Remounts device-local folder presentation when its user/Workspace scope changes. */
export function FileTree(props: FileTreeProps) {
  const userId = useAuth().user?.id ?? '__anonymous__';
  const collapsedStorageKey = `ldaca-wordflow-collapsed-folders-v2:${userId}:${props.workspaceId ?? '__none__'}`;
  return (
    <FileTreeContent
      key={collapsedStorageKey}
      {...props}
      collapsedStorageKey={collapsedStorageKey}
    />
  );
}

/**
 * Renders the nested file browser for uploaded data. `DataLoaderFeature` uses
 * it for preview/add/download/delete actions plus drag-to-move file handling.
 * Rendered by `DataLoaderFeature`; file-browser hooks supply its side-effect callbacks.
 * Flow: build rows from the browser tree, attach move/drop/create-folder handlers, and expose
 * add/preview/delete/download actions for selected files.
 */
function FileTreeContent({
  nodes,
  selectedFile,
  loadingFiles,
  hasWorkspaceSelected,
  collapsedStorageKey,
  onPreviewFile,
  onAddFile,
  onSelectFile,
  onDownloadFile,
  onDeleteFile,
  onCreateFolderInside,
  onOpenCitation,
  onMoveFile,
}: FileTreeContentProps) {
  const [draggingFilePath, setDraggingFilePath] = useState<string | null>(null);
  const [fileMoveTarget, setFileMoveTarget] = useState<FileMoveTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const [storedCollapsedPaths, setStoredCollapsedPaths] = useState<Set<string>>(() => {
    try {
      const persisted = localStorage.getItem(collapsedStorageKey);
      return persisted ? new Set<string>(JSON.parse(persisted) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const authoritativeDirectoryPaths = useMemo(() => new Set(directoryPathsIn(nodes)), [nodes]);
  const collapsedPaths = useMemo(
    () =>
      new Set([...storedCollapsedPaths].filter((path) => authoritativeDirectoryPaths.has(path))),
    [authoritativeDirectoryPaths, storedCollapsedPaths],
  );

  useEffect(() => {
    if (collapsedPaths.size === storedCollapsedPaths.size) return;
    try {
      localStorage.setItem(collapsedStorageKey, JSON.stringify([...collapsedPaths]));
    } catch {
      // Device-local presentation persistence is best effort.
    }
  }, [collapsedPaths, collapsedStorageKey, storedCollapsedPaths.size]);

  const handleToggleCollapse = (path: string, isOpen: boolean) => {
    setStoredCollapsedPaths((previous) => {
      const next = new Set(
        [...previous].filter((candidate) => authoritativeDirectoryPaths.has(candidate)),
      );
      if (isOpen) {
        next.delete(path);
      } else {
        next.add(path);
      }
      try {
        localStorage.setItem(collapsedStorageKey, JSON.stringify(Array.from(next)));
      } catch (e) {
        console.error('Failed to persist collapsed folders:', e);
      }
      return next;
    });
  };

  /**
   * Recovers the dragged file path from custom drag metadata with a local state
   * fallback for browsers that clear dataTransfer during nested drag events.
   * Called by directory hover and drop handlers.
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
   * Called by move-target rendering, drag-over, and drop paths.
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
   * Called while rendering directory and file-row drop targets.
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
   * Attached by `renderFile` to each draggable file row's `onDragStart`.
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
   * Attached by `renderFile` to each draggable file row's `onDragEnd`.
   */
  const handleTreeFileDragEnd = () => {
    setDraggingFilePath(null);
    setFileMoveTarget(null);
  };

  /**
   * Marks a directory/file-row parent as a valid move destination while the
   * dragged file is over it.
   * Shared by directory rows and file-row parent drop zones.
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
   * Shared by directory and file-row `onDragLeave` props.
   */
  const handleDirectoryDragLeave = (targetKey: string, event: React.DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setFileMoveTarget((current) => (current?.key === targetKey ? null : current));
  };

  /**
   * Completes a file move into the target directory. File and folder rows share
   * this drop path through the parent `onMoveFile` callback.
   * Shared by directory and file-row `onDrop` props.
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
   * Rendered by: FileTree JSX render path.
   * Flow: derive file metadata/actions, attach drag payload and citation/download/delete
   * handlers, then render a row with add-to-workspace affordances.
   */
  const renderFileItem = (file: FileTreeFile, parentDirectoryPath: string) => (
    <div
      key={file.path}
      draggable
      data-file-path={file.path}
      data-testid={`file-row-${file.path}`}
      onDragStart={(event) => {
        handleTreeFileDragStart(event, file.path);
      }}
      onDragEnd={handleTreeFileDragEnd}
      onDragEnter={(event) => {
        handleDirectoryDragOver(`file:${file.path}`, parentDirectoryPath, event);
      }}
      onDragOver={(event) => {
        handleDirectoryDragOver(`file:${file.path}`, parentDirectoryPath, event);
      }}
      onDragLeave={(event) => {
        handleDirectoryDragLeave(`file:${file.path}`, event);
      }}
      onDrop={(event) => void handleDirectoryDrop(parentDirectoryPath, event)}
      className={`group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-list-hover/50 ${
        selectedFile === file.path ? 'bg-panel/50' : ''
      } ${
        isFileMoveTargetActive(`file:${file.path}`, parentDirectoryPath)
          ? 'bg-button/10 ring-1 ring-focus/30'
          : ''
      }`}
    >
      <FileIcon className="h-4 w-4 shrink-0 text-description" />
      <div className="@container/file-row flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-[1_1_14rem]">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-body font-medium text-foreground">{file.name}</span>
          </div>
          <div className="flex items-center gap-2 text-label-secondary text-description">
            <span>{formatBytes(file.size)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            aria-label="Preview"
            onClick={() => {
              onPreviewFile(file.path);
            }}
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden @min-[640px]/file-row:inline">Preview</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            aria-label="Add"
            data-guidance="add-data-block"
            disabled={!hasWorkspaceSelected}
            title={
              hasWorkspaceSelected
                ? 'Add this file as a Data Block'
                : 'Load a workspace to add this file as a Data Block'
            }
            onClick={() => {
              onAddFile(file.path);
              onSelectFile(file.path);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden @min-[640px]/file-row:inline">Add</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            aria-label={`Download ${file.name}`}
            title={`Download ${file.name}`}
            onClick={() => {
              onDownloadFile(file.path);
            }}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            <span className="hidden @min-[640px]/file-row:inline">Download</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-error hover:bg-error/10 hover:text-error"
            aria-label={`Delete ${file.name}`}
            title={`Delete ${file.name}`}
            onClick={() => {
              setDeleteTarget({ path: file.path, name: file.name, type: 'file' });
            }}
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
   * Rendered by: FileTree JSX render path.
   * Flow: split directory and file branches, render visible children recursively, and keep
   * folder/citation/delete affordances beside the relevant tree row.
   */
  const renderNode = (node: FileTreeNode): React.ReactNode => {
    if (node.type === 'file') {
      return renderFileItem(node, getParentDirectoryPath(node.path));
    }
    const fileCount = countFilesInNode(node);
    const citationFile = getCitationFile(node);
    const visibleChildren = getVisibleDirectoryChildren(node);
    const isCollapsed = collapsedPaths.has(node.path);
    return (
      <Collapsible
        key={node.path}
        open={!isCollapsed}
        onOpenChange={(isOpen) => {
          handleToggleCollapse(node.path, isOpen);
        }}
      >
        <div
          className={`flex flex-wrap items-center gap-1 rounded-md pr-1 hover:bg-list-hover/50 ${
            isFileMoveTargetActive(`folder:${node.path}`, node.path)
              ? 'bg-button/10 ring-1 ring-focus/30'
              : ''
          }`}
          data-folder-path={node.path}
          data-testid={`folder-row-${node.path}`}
          onDragEnter={(event) => {
            handleDirectoryDragOver(`folder:${node.path}`, node.path, event);
          }}
          onDragOver={(event) => {
            handleDirectoryDragOver(`folder:${node.path}`, node.path, event);
          }}
          onDragLeave={(event) => {
            handleDirectoryDragLeave(`folder:${node.path}`, event);
          }}
          onDrop={(event) => void handleDirectoryDrop(node.path, event)}
        >
          <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-1 rounded-md">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="group h-8 min-w-0 justify-start gap-1 px-2 transition-none hover:bg-transparent hover:text-foreground"
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
                className="h-7 w-7 shrink-0 text-description hover:text-foreground"
                aria-label={`View citation for ${node.name}`}
                title="View citation"
                onClick={() => {
                  onOpenCitation(node, citationFile.path);
                }}
              >
                <Quote className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-description hover:text-foreground"
            aria-label={`Add folder inside ${node.name}`}
            title={`Add folder inside ${node.name}`}
            onClick={() => {
              onCreateFolderInside(node.path, node.name);
            }}
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-error hover:bg-error/10 hover:text-error"
            aria-label={`Delete folder ${node.name}`}
            title={`Delete folder ${node.name}`}
            onClick={() => {
              setDeleteTarget({ path: node.path, name: node.name, type: 'directory' });
            }}
            disabled={loadingFiles}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Badge variant="secondary" className="text-badge">
            {fileCount}
          </Badge>
        </div>
        <CollapsibleContent className="ml-3 sm:ml-5">
          <div className="flex flex-col gap-0.5 border-l border-surface-border/40 pl-2">
            {visibleChildren.map((child) => renderNode(child))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <>
      {nodes.map((node) => renderNode(node))}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.type === 'directory' ? 'folder ' : ''}&ldquo;
              {deleteTarget?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === 'directory'
                ? `This will permanently delete "${deleteTarget.name}" and everything inside it. This action cannot be undone.`
                : `This will permanently delete "${deleteTarget?.name ?? 'this file'}". This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loadingFiles}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-error text-button-foreground hover:bg-error/90"
              disabled={loadingFiles}
              onClick={() => {
                if (!deleteTarget) return;
                onDeleteFile(deleteTarget.path);
                setDeleteTarget(null);
              }}
            >
              {deleteTarget?.type === 'directory' ? 'Delete folder' : 'Delete file'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
