import { useState, useEffect } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { filesApi } from '../api/files';
import { useAuth } from './useAuth';

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
    queryKey: ['file-preview', filename, page, pageSize, selectedSheet],
    queryFn: async () => {
      if (!filename) throw new Error('No filename provided');
      const headers = getAuthHeaders();
      const response = await filesApi.preview(
        {
          filename,
          page,
          page_size: pageSize,
          payload: selectedSheet ? { sheet_name: selectedSheet } : undefined,
        },
        headers
      );
      return response;
    },
    enabled: !!filename && isOpen,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const reset = () => {
    setPage(0);
    setSelectedSheet(null);
  };

  return {
    previewData: data?.preview || [],
    columns: data?.columns || (data?.preview?.[0] ? Object.keys(data.preview[0]) : []),
    totalRows: data?.total_rows ?? 0,
    fileType: data?.file_type || null,
    sheetNames: data?.sheet_names || null,
    supportedTypes: data?.supported_types || [],
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

