import { useState, useCallback, useRef, useEffect } from 'react';
import { getFilePreview } from '../api';
import { useAuth } from './useAuth';

export const useFilePreview = () => {
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getAuthHeaders } = useAuth();

  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);

  const fetchPreview = useCallback(async (fileName: string, nextPage?: number) => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
  const effectivePage = typeof nextPage === 'number' ? nextPage : pageRef.current;
  const response = await getFilePreview(fileName, headers, { page: effectivePage, pageSize });
      const data = response.preview || response.dataframe || [];
      setPreviewData(data);
      setColumns(response.columns || Object.keys(data?.[0] || {}));
      setTotalRows(response.total_rows ?? data.length);
      if (typeof nextPage === 'number') setPage(nextPage);
      return data;
    } catch (err) {
      setError('Failed to load preview');
      setPreviewData([]);
      setColumns([]);
      setTotalRows(0);
      return [];
    } finally {
      setLoading(false);
    }
  }, [pageSize, getAuthHeaders]);

  const clearPreview = useCallback(() => {
    setPreviewData([]);
    setError(null);
    setLoading(false);
    setColumns([]);
    setTotalRows(0);
    setPage(0);
  }, []);

  return {
    previewData,
    columns,
    totalRows,
    page,
    pageSize,
    loading,
    error,
    fetchPreview,
    clearPreview,
    setPage,
    setPageSize
  };
};
