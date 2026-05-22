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

// Mirrors the server-side default-name derivation in
// ``backend/api/workspaces/base.py::add_node_to_workspace``: strip a known
// data-file extension, then keep only the last one or two path components.
// Used to populate the Add panel's name-input placeholder so it matches
// exactly what the server would derive if the user leaves the field blank.
const STRIPPABLE_EXTENSIONS = ['.csv', '.tsv', '.xlsx', '.json', '.jsonl', '.parquet'];

export function defaultNodeNameFromFile(filename: string): string {
  if (!filename) return '';
  let name = filename;
  for (const ext of STRIPPABLE_EXTENSIONS) {
    if (name.toLowerCase().endsWith(ext)) {
      name = name.slice(0, -ext.length);
      break;
    }
  }
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('/');
  return parts[0] ?? '';
}
