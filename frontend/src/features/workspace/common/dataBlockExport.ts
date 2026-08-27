import { exportDataBlocks, type DataBlockExportFormat } from '@/api';
import { safeDownloadStem, saveDataBlockDownload } from '@/lib/download';

export const DATA_BLOCK_EXPORT_FORMATS: {
  value: DataBlockExportFormat;
  label: string;
  extension: string;
}[] = [
  { value: 'csv', label: 'CSV (.csv)', extension: 'csv' },
  { value: 'json', label: 'JSON (.json)', extension: 'json' },
  { value: 'ndjson', label: 'NDJSON (.ndjson)', extension: 'ndjson' },
  { value: 'parquet', label: 'Parquet (.parquet)', extension: 'parquet' },
  { value: 'ipc', label: 'Arrow IPC (.arrow)', extension: 'arrow' },
];

export interface DataBlockExportSelection {
  id: string;
  name: string;
}

const filenameFromResponse = (response: Response | undefined): string | null => {
  const disposition = response?.headers.get('content-disposition');
  if (!disposition) return null;
  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1]);
    } catch {
      return null;
    }
  }
  return /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? null;
};

/** Downloads one direct Data Block file or one server-built multi-block ZIP. */
export const downloadDataBlocks = async ({
  workspaceId,
  workspaceName,
  dataBlocks,
  format,
}: {
  workspaceId: string;
  workspaceName: string;
  dataBlocks: DataBlockExportSelection[];
  format: DataBlockExportFormat;
}): Promise<string> => {
  const formatSpec = DATA_BLOCK_EXPORT_FORMATS.find((candidate) => candidate.value === format);
  const fallbackFilename =
    dataBlocks.length > 1
      ? `${safeDownloadStem(workspaceName, workspaceId)}_data_blocks.zip`
      : `${safeDownloadStem(dataBlocks[0]?.name ?? '', dataBlocks[0]?.id ?? 'data-block')}.${formatSpec?.extension ?? format}`;
  let filename = fallbackFilename;
  await saveDataBlockDownload({
    workspaceId,
    nodeIds: dataBlocks.map((node) => node.id),
    format,
    filename: fallbackFilename,
    loadBrowserDownload: async () => {
      const { data, response } = await exportDataBlocks({
        parseAs: 'blob',
        path: { workspace_id: workspaceId },
        body: { node_ids: dataBlocks.map((node) => node.id), format },
        throwOnError: true,
      });
      filename = filenameFromResponse(response) ?? fallbackFilename;
      return { blob: data, filename };
    },
  });
  return filename;
};
