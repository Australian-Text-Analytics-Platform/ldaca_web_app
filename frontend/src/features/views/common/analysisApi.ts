import { getAnalysis, getAnalysisResult, normalizeAnalysisResult } from '@/api';
import type { TokenFrequencyResult } from '@/api';
import { fetchArrowTable } from '@/lib/arrow/arrowTable';

/** Fetches the canonical analysis resource owned by a workspace. */
async function getAnalysisResource(workspaceId: string, analysisId: string) {
  const { data } = await getAnalysis({
    path: { workspace_id: workspaceId, analysis_id: analysisId },
    throwOnError: true,
  });
  return data;
}

/** Returns the submitted request payload used to hydrate an analysis tab. */
export async function getAnalysisRequest(
  workspaceId: string,
  analysisId: string,
): Promise<unknown> {
  const analysis = await getAnalysisResource(workspaceId, analysisId);
  return analysis.request;
}

/** Fetches and normalizes the typed result for one analysis. */
export async function getAnalysisResultResource<TResult>(
  workspaceId: string,
  analysisId: string,
): Promise<TResult | null> {
  const [analysisResponse, resultResponse] = await Promise.all([
    getAnalysisResource(workspaceId, analysisId),
    getAnalysisResult({
      path: { workspace_id: workspaceId, analysis_id: analysisId },
      throwOnError: true,
    }),
  ]);
  const result = resultResponse.data;
  if (result.kind === 'token_frequency') {
    const tokenResult = result as TokenFrequencyResult;
    const entries = await Promise.all(
      tokenResult.tables.nodes.map(async (node) => {
        const table = await fetchArrowTable(node.table.url);
        return [
          node.node_id,
          {
            data: table.rows,
            metadata: { node_id: node.node_id, display_name: node.node_name },
          },
        ] as const;
      }),
    );
    const statistics = tokenResult.tables.statistics
      ? (await fetchArrowTable(tokenResult.tables.statistics.url)).rows
      : [];
    return normalizeAnalysisResult(
      { ...tokenResult, data: Object.fromEntries(entries), statistics },
      analysisResponse,
    ) as TResult;
  }
  if (result.kind === 'sequential') {
    const table = await fetchArrowTable(result.table.url);
    return normalizeAnalysisResult({ ...result, data: table.rows }, analysisResponse) as TResult;
  }
  return normalizeAnalysisResult(result, analysisResponse) as TResult;
}
