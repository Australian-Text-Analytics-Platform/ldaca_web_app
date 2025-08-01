import { useState, useCallback } from 'react';
import { getFilePreview } from '../api';

export const useFilePreview = () => {
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPreview = useCallback(async (fileName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await getFilePreview(fileName);
      setPreviewData(response.dataframe || []);
      return response.dataframe || [];
    } catch (err) {
      setError('Failed to load preview');
      setPreviewData([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const clearPreview = useCallback(() => {
    setPreviewData([]);
    setError(null);
    setLoading(false);
  }, []);

  return {
    previewData,
    loading,
    error,
    fetchPreview,
    clearPreview
  };
};
