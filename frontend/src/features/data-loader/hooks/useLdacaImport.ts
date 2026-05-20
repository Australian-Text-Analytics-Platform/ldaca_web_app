import { useState } from 'react';
import { filesApi } from '@/api/files';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;

interface UseLdacaImportParams {
  authHeaders: Record<string, string>;
  refetchFiles: () => Promise<unknown>;
  notify: Notify;
}

export function useLdacaImport({
  authHeaders,
  refetchFiles,
  notify,
}: UseLdacaImportParams) {
  const [ldacaImportOpen, setLdacaImportOpen] = useState(false);
  const [ldacaUrl, setLdacaUrl] = useState('');
  const [ldacaImporting, setLdacaImporting] = useState(false);

  const handleLdacaImport = async () => {
    const trimmedUrl = ldacaUrl.trim();
    if (!trimmedUrl) return;

    setLdacaImporting(true);
    try {
      const response = await filesApi.importLdaca(trimmedUrl, authHeaders);

      notify('success', response.message || 'LDaCA import started in background.');
      setLdacaUrl('');
      setLdacaImportOpen(false);
      await refetchFiles();
    } catch (error) {
      notify('error', (error as Error).message || 'Failed to start LDaCA import.');
    } finally {
      setLdacaImporting(false);
    }
  };

  return {
    ldacaImportOpen,
    setLdacaImportOpen,
    ldacaUrl,
    setLdacaUrl,
    ldacaImporting,
    handleLdacaImport,
  };
}
