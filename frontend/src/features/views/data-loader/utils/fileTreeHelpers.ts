import type {
  FileTreeDirectory,
  FileTreeFile,
  FileTreeNode,
} from '@/features/views/data-loader/types';

const README_FILENAME = 'README.md';
export const FILE_DRAG_MIME_TYPE = 'application/x-ldaca-file-path';

/**
 * Projects the complete User File tree into the Data Loader's presentation:
 * unsupported file leaves disappear while every directory remains visible.
 * Used by `useFiles` after the backend resource list is normalized.
 */
export function filterLoadableFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const filtered: FileTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.loadable === true) filtered.push(node);
      continue;
    }
    filtered.push({ ...node, children: filterLoadableFileTree(node.children) });
  }
  return filtered;
}

/**
 * Counts visible data files below a file-tree node. Data Loader excludes README
 * citation files from totals because they are shown as folder metadata instead.
 * Used by `DataLoaderFeature` to summarize the server file tree.
 */
export function countFilesInNode(node: FileTreeNode): number {
  if (node.type === 'file') {
    return node.name.toLowerCase() === README_FILENAME.toLowerCase() ? 0 : 1;
  }
  return node.children.reduce((sum, child) => sum + countFilesInNode(child), 0);
}

/**
 * Finds the README citation file attached to a directory. `FileTree` uses this
 * to expose citation viewing without rendering README.md as a normal data file.
 * Used by: FileTree component.
 */
export function getCitationFile(directory: FileTreeDirectory): FileTreeFile | null {
  const child = directory.children.find(
    (candidate): candidate is FileTreeFile =>
      candidate.type === 'file' && candidate.name.toLowerCase() === README_FILENAME.toLowerCase(),
  );
  return child ?? null;
}

/**
 * Returns children that should appear in the file browser, hiding citation
 * README files that are represented by the folder citation action.
 * Used by: FileTree component.
 */
export function getVisibleDirectoryChildren(directory: FileTreeDirectory): FileTreeNode[] {
  return directory.children.filter(
    (child) => child.type !== 'file' || child.name.toLowerCase() !== README_FILENAME.toLowerCase(),
  );
}

/**
 * Derives a file's parent directory path for drag-to-move checks and drop
 * target routing in `FileTree`.
 * Used by: FileTree component.
 */
export function getParentDirectoryPath(filePath: string): string {
  const lastSlashIndex = filePath.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : filePath.slice(0, lastSlashIndex);
}
