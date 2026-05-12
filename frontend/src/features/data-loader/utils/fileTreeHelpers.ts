import type { FileTreeDirectory, FileTreeFile, FileTreeNode } from '@/types';

export const README_FILENAME = 'README.md';
export const FILE_DRAG_MIME_TYPE = 'application/x-ldaca-file-path';

export function countFilesInNode(node: FileTreeNode): number {
  if (node.type === 'file') {
    return node.name.toLowerCase() === README_FILENAME.toLowerCase() ? 0 : 1;
  }
  return node.children.reduce((sum, child) => sum + countFilesInNode(child), 0);
}

export function getCitationFile(directory: FileTreeDirectory): FileTreeFile | null {
  const child = directory.children.find(
    (candidate): candidate is FileTreeFile =>
      candidate.type === 'file' && candidate.name.toLowerCase() === README_FILENAME.toLowerCase(),
  );
  return child ?? null;
}

export function getVisibleDirectoryChildren(directory: FileTreeDirectory): FileTreeNode[] {
  return directory.children.filter(
    (child) => child.type !== 'file' || child.name.toLowerCase() !== README_FILENAME.toLowerCase(),
  );
}

export function getParentDirectoryPath(filePath: string): string {
  const lastSlashIndex = filePath.lastIndexOf('/');
  return lastSlashIndex === -1 ? '' : filePath.slice(0, lastSlashIndex);
}
