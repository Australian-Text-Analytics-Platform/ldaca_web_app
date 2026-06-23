import type { FileTreeNodeResponse } from '@/api';

/** File-tree leaf used by upload/browser panels after generated API nodes are normalized. */
export type FileTreeFile = Omit<FileTreeNodeResponse, 'children' | 'size' | 'type'> & {
  type: 'file';
  size: number;
};

/** File-tree branch shape consumed recursively by data-loader tree components. */
export type FileTreeDirectory = Omit<FileTreeNodeResponse, 'children' | 'type'> & {
  type: 'directory';
  children: FileTreeNode[];
};

/** Discriminated file-tree node used wherever folder and file rows are rendered together. */
export type FileTreeNode = FileTreeFile | FileTreeDirectory;
