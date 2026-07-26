import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

/** Refreshes the user-visible tree without disturbing cached file projections. */
export function invalidateFileListQuery(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.fileList, exact: true });
}

/**
 * Drops every cached projection of a path after replacement or deletion, then
 * refreshes the file tree.
 */
export function refreshFilePathQuery(queryClient: QueryClient, path: string) {
  queryClient.removeQueries({ queryKey: queryKeys.file(path) });
  return invalidateFileListQuery(queryClient);
}

/**
 * Removes both path identities affected by a move before refreshing the tree.
 */
export function refreshMovedFileQueries(
  queryClient: QueryClient,
  sourcePath: string,
  targetDirectoryPath: string,
) {
  const filename = sourcePath.split('/').at(-1) ?? sourcePath;
  const targetPath = targetDirectoryPath ? `${targetDirectoryPath}/${filename}` : filename;
  queryClient.removeQueries({ queryKey: queryKeys.file(sourcePath) });
  queryClient.removeQueries({ queryKey: queryKeys.file(targetPath) });
  return invalidateFileListQuery(queryClient);
}
