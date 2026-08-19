import { getAnalysis, getAnalysisResult, queryAnalysisResult } from '@/api';
import type {
  ConcordanceAnalysisResponse,
  ConcordanceResult,
  TokenFrequencyResult,
  TopicModelingResult,
  TopicModelingResultQuery,
} from '@/api';
import { fetchArrowTable } from '@/lib/arrow/arrowTable';

/** Fetches the canonical analysis resource owned by a workspace. */
export async function getAnalysisResource(workspaceId: string, analysisId: string) {
  const { data } = await getAnalysis({
    path: { workspace_id: workspaceId, analysis_id: analysisId },
    throwOnError: true,
  });
  return data;
}

/** Fetches the output-only Result resource without combining lifecycle state. */
export async function getAnalysisOutputResource(workspaceId: string, analysisId: string) {
  const { data } = await getAnalysisResult({
    path: { workspace_id: workspaceId, analysis_id: analysisId },
    throwOnError: true,
  });
  return data;
}

/** Projects the generated Concordance Result into its node-keyed table view. */
export function projectConcordanceResult(
  concordance: ConcordanceResult,
): ConcordanceAnalysisResponse {
  if (!concordance.sources) {
    throw new Error('Concordance Result page is unavailable');
  }
  const sources = concordance.sources;
  const entries = sources.map((source) => {
    const page = source.result;
    return [
      source.node_id,
      {
        ...page,
        metadata: {
          ...page.metadata,
          metadata_columns: page.metadata.metadata_columns ?? [],
          concordance_columns: page.metadata.concordance_columns ?? [],
          quotation_columns: page.metadata.quotation_columns ?? [],
        },
      },
    ] as const;
  });
  const firstPage = sources[0]?.result;
  return {
    ...concordance,
    data: Object.fromEntries(entries),
    combinable: sources.length === 2,
    metadata: firstPage?.metadata ?? {
      metadata_columns: [],
      concordance_columns: [],
      quotation_columns: [],
      all_columns: [],
    },
  };
}

/** Fetches and normalizes the typed result for one analysis. */
export async function getAnalysisResultResource<TResult>(
  workspaceId: string,
  analysisId: string,
  projectionQuery?: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<TResult> {
  const topicProjection = projectionQuery as TopicModelingResultQuery | undefined;
  const { data: result } = topicProjection
    ? await queryAnalysisResult({
        path: { workspace_id: workspaceId, analysis_id: analysisId },
        body: { ...topicProjection, kind: 'topic_modeling' },
        signal,
        throwOnError: true,
      })
    : await getAnalysisResult({
        path: { workspace_id: workspaceId, analysis_id: analysisId },
        signal,
        throwOnError: true,
      });
  if (result.kind === 'concordance') {
    const page =
      result.sources == null
        ? (
            await queryAnalysisResult({
              path: { workspace_id: workspaceId, analysis_id: analysisId },
              body: { kind: 'concordance' },
              throwOnError: true,
            })
          ).data
        : result;
    if (page.kind !== 'concordance') {
      throw new Error('Concordance query returned the wrong Result kind');
    }
    return projectConcordanceResult(page) as TResult;
  }
  if (result.kind === 'quotation' && result.data == null) {
    const { data } = await queryAnalysisResult({
      path: { workspace_id: workspaceId, analysis_id: analysisId },
      body: { kind: 'quotation' },
      throwOnError: true,
    });
    return data as TResult;
  }
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
    return { ...tokenResult, data: Object.fromEntries(entries), statistics } as TResult;
  }
  if (result.kind === 'topic_modeling') {
    const topicResult = result as TopicModelingResult;
    return {
      ...topicResult,
      data: {
        topics: topicResult.topics,
        corpus_sizes: topicResult.corpus_sizes,
        meta: topicResult.meta,
        per_corpus_topic_counts: topicResult.per_corpus_topic_counts,
      },
    } as TResult;
  }
  if (result.kind === 'sequential') {
    const table = await fetchArrowTable(result.table.url);
    return { ...result, data: table.rows } as TResult;
  }
  return result as TResult;
}
