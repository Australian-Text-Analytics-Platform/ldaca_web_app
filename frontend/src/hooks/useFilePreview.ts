import { useState, useCallback, useRef, useEffect } from 'react';
import { filesApi } from '../api/files';
import { useAuth } from './useAuth';

export const useFilePreview = () => {
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [fileType, setFileType] = useState<string | null>(null);
  const [supportedTypes, setSupportedTypes] = useState<string[]>([]);
  const [sheetNames, setSheetNames] = useState<string[] | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { getAuthHeaders } = useAuth();

  const pageRef = useRef(page);
  useEffect(() => { pageRef.current = page; }, [page]);

  const fetchPreview = useCallback(async (fileName: string, nextPage?: number, opts?: { sheetName?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      const effectivePage = typeof nextPage === 'number' ? nextPage : pageRef.current;
  const response = await filesApi.preview({
        filename: fileName,
        page: effectivePage,
        page_size: pageSize,
        payload: opts?.sheetName ? { sheet_name: opts.sheetName } : undefined,
      }, headers);
      const data = response.preview || [];
      setPreviewData(data);
      setColumns(response.columns || Object.keys(data?.[0] || {}));
      setTotalRows(response.total_rows ?? data.length);
      setFileType(response.file_type || null);
      setSupportedTypes(response.supported_types || []);
      setSheetNames(response.sheet_names || null);
      setSelectedSheet(response.selected_sheet || null);
      if (typeof nextPage === 'number') setPage(nextPage);
      return data;
    } catch (err) {
      setError('Failed to load preview');
      setPreviewData([]);
      setColumns([]);
      setTotalRows(0);
      setFileType(null);
      setSupportedTypes([]);
      setSheetNames(null);
      setSelectedSheet(null);
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
  setFileType(null);
  setSupportedTypes([]);
  setSheetNames(null);
  setSelectedSheet(null);
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
  setPageSize,
  fileType,
  supportedTypes,
  sheetNames,
  selectedSheet,
  setSelectedSheet
  };
};
