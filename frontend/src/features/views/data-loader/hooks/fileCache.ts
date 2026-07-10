import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Applies the Data Loader's single post-mutation file-tree cache policy.
 * Used by: upload, delete, move, folder-creation, and sample-import owners so
 * each successful foreground mutation invalidates the shared file query once.
 */
export function invalidateFilesQuery(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.files });
}
