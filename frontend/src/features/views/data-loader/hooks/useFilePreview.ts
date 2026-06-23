import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { unifiedFilePreview } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/features/auth/hooks/useAuth';

/** Manages paginated file preview state for the data-loader preview dialog. */
/**
 * Used by: src/components/panels/AddFilePanel.tsx, src/components/panels/FilePreviewPanel.tsx because the hook needs local steps to normalize inputs before exposing stable state to consumers.
 * Flow: reset page/sheet state when the dialog closes, query the requested preview page, then expose rows, columns, paging, and sheet controls.
 */
export const useFilePreview = (filename: string | null, isOpen: boolean) => {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);

  const { getAuthHeaders } = useAuth();

  /* eslint-disable react-hooks/set-state-in-effect -- Resetting local UI state on prop change; no cascading renders */
  useEffect(() => {
    if (!isOpen) {
      setPage(0);
      setSelectedSheet(null);
    }
  }, [isOpen, filename]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.filePreview(filename ?? '', page, pageSize, selectedSheet),
    /** Loads the current preview page only when the dialog has a filename to display. */
    /** Called by: TanStack Query inside useFilePreview because query callers need stable cache keys, fetchers, and invalidation targets for the request lifecycle. */
    queryFn: async () => {
      if (!filename) throw new Error('No filename provided');
      const headers = getAuthHeaders();
      const { data } = await unifiedFilePreview({
        body: {
          filename,
          page,
          page_size: pageSize,
          payload: selectedSheet ? { sheet_name: selectedSheet } : undefined,
        },
        headers,
        throwOnError: true,
      });
      return data;
    },
    enabled: !!filename && isOpen,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  /** Resets preview paging/sheet state when a caller closes or switches the preview. */
  /** Used by: useFilePreview callback wiring in this module because the component or hook needs a named callback boundary for effect and prop handoff steps. */
  const reset = () => {
    setPage(0);
    setSelectedSheet(null);
  };

  return {
    previewData: data?.preview ?? [],
    columns: data?.columns ?? (data?.preview[0] ? Object.keys(data.preview[0]) : []),
    totalRows: data?.total_rows ?? 0,
    // file_type is a required non-empty backend type identifier; '' should fall back to null
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    fileType: data?.file_type || null,
    sheetNames: data?.sheet_names ?? null,
    supportedTypes: data?.supported_types ?? [],
    selectedSheet: selectedSheet ?? data?.selected_sheet ?? null,
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
