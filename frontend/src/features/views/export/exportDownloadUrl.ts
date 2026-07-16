import type { ExportNodesData } from '@/api';
import { getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';

const EXPORT_NODES_PATH: ExportNodesData['url'] = '/api/workspaces/{workspace_id}/export';

type ExportDownloadRequest = Pick<ExportNodesData, 'path' | 'query'>;

/** Builds the relative API path accepted by the supervised desktop downloader. */
export function buildExportNodesDownloadPath({ path, query }: ExportDownloadRequest): string {
  const endpoint = EXPORT_NODES_PATH.replace(
    '{workspace_id}',
    encodeURIComponent(path.workspace_id),
  );
  const params = new URLSearchParams();
  params.set('node_ids', query.node_ids);
  if (query.format !== undefined) {
    params.set('format', query.format);
  }

  return `${endpoint}?${params.toString()}`;
}

/** Adds the configured backend origin for an ordinary browser fetch. */
export function buildExportNodesDownloadUrl(request: ExportDownloadRequest): string {
  return `${getGeneratedApiBase()}${buildExportNodesDownloadPath(request)}`;
}
