import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { listFileWorksheets, previewFileTable } from '@/api';
import { queryKeys } from '@/lib/queryKeys';

/** Manages paginated file preview state for the data-loader preview dialog. */
/**
 * Used by: `AddFilePanel` and `FilePreviewPanel`.
 * Flow: reset page/sheet state when the dialog closes, query the requested preview page, then expose rows, columns, paging, and sheet controls.
 */
export const useFilePreview = (filename: string | null, isOpen: boolean) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- Resetting local UI state on prop change; no cascading renders */
  useEffect(() => {
    if (!isOpen) {
      setPage(1);
      setSelectedSheet(null);
    }
  }, [isOpen, filename]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isExcel = Boolean(filename && /\.(xlsx?|xlsb)$/i.test(filename));
  const worksheetsQuery = useQuery({
    queryKey: queryKeys.fileWorksheets(filename ?? ''),
    queryFn: async () => {
      if (!filename) throw new Error('No filename provided');
      const { data } = await listFileWorksheets({
        query: { path: filename },
        throwOnError: true,
      });
      return data;
    },
    enabled: Boolean(filename && isOpen && isExcel),
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.filePreview(filename ?? '', page, pageSize, selectedSheet),
    /** Loads the current preview page only when the dialog has a filename to display. */
    /** Called by: TanStack Query inside useFilePreview. */
    queryFn: async () => {
      if (!filename) throw new Error('No filename provided');
      return previewFileTable({
        query: {
          path: filename,
          page,
          page_size: pageSize,
          sheet_name: selectedSheet,
        },
      });
    },
    enabled: !!filename && isOpen,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const reset = () => {
    setPage(1);
    setSelectedSheet(null);
  };

  return {
    previewData: data?.rows ?? [],
    columns: data?.columns ?? [],
    hasNext: data?.hasNext ?? false,
    fileType: isExcel ? 'excel' : null,
    sheetNames: worksheetsQuery.data?.sheets ?? null,
    selectedSheet: selectedSheet ?? worksheetsQuery.data?.default_sheet ?? null,
    setSelectedSheet,
    page,
    setPage,
    pageSize,
    setPageSize,
    loading: isLoading,
    error: isError ? (error instanceof Error ? error.message : 'Failed to load preview') : null,
    reset,
  };
};
