import type { ExportNodesData } from '@/api';
import { getGeneratedApiBase } from '@/lib/backend/generatedClientConfig';

const EXPORT_NODES_PATH: ExportNodesData['url'] = '/api/workspaces/{workspace_id}/export';

type ExportDownloadRequest = Pick<ExportNodesData, 'path' | 'query'>;

/**
 * Builds the raw export URL used by browser and Tauri blob downloads.
 * Used by: ExportFeature because those download paths need a URL string while
 * still sharing the generated endpoint's workspace path and query contract.
 * Flow: start from the generated-client API base, substitute the workspace path
 * parameter, serialize the generated query shape, then return the fetchable URL.
 */
export function buildExportNodesDownloadUrl({ path, query }: ExportDownloadRequest): string {
  const endpoint = EXPORT_NODES_PATH.replace(
    '{workspace_id}',
    encodeURIComponent(path.workspace_id),
  );
  const params = new URLSearchParams();
  params.set('node_ids', query.node_ids);
  if (query.format !== undefined) {
    params.set('format', query.format);
  }

  return `${getGeneratedApiBase()}${endpoint}?${params.toString()}`;
}
