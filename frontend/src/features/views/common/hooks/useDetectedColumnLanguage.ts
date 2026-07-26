import { useQuery } from '@tanstack/react-query';
import { queryWorkspaceSqlTable, sqlIdentifier, sqlTable } from '@/api';
import { detectLanguageIso6391 } from '@/lib/languageDetection';
import { createNodeDataRequest, queryKeys } from '@/lib/queryKeys';
import { collectDocumentColumnText } from '../components/tokenizerModelSelectorUtils';

const LANGUAGE_SAMPLE_PAGE_SIZE = 100;
const LANGUAGE_SAMPLE_REQUEST = createNodeDataRequest({
  page: 1,
  page_size: LANGUAGE_SAMPLE_PAGE_SIZE,
});

export interface UseDetectedColumnLanguageArgs {
  workspaceId: string | null;
  nodeId: string | null;
  column: string | null;
  /** When false the sample fetch and detection are skipped (e.g. dialog closed). */
  enabled?: boolean;
}

export interface DetectedColumnLanguage {
  /** Guessed ISO 639-1 code, or null while detecting or when undetectable. */
  detectedLanguage: string | null;
  /** True while either the sample fetch or the detection query is in flight. */
  isDetecting: boolean;
}

/**
 * Samples a node's text column and guesses its ISO 639-1 language.
 * Used by: TokenizerModelSelector (to recommend language-matching models) and
 * FillDefaultStopWordsDialog (to pre-select a guessed stoplist) because both
 * need the same "fetch a page of rows, concatenate the column, detect language"
 * behavior without storing the language anywhere.
 * Flow: fetch a sample page when enabled, collect the column text, then run
 * client-side detection on that text; both queries cache so reopening is cheap.
 */
export function useDetectedColumnLanguage({
  workspaceId,
  nodeId,
  column,
  enabled = true,
}: UseDetectedColumnLanguageArgs): DetectedColumnLanguage {
  const canFetchSample = Boolean(enabled && workspaceId && nodeId && column);
  const sql = nodeId && column ? `SELECT ${sqlIdentifier(column)} FROM ${sqlTable(nodeId)}` : '';
  const sampleQuery = useQuery({
    queryKey:
      workspaceId && nodeId
        ? queryKeys.workspaceSql(
            workspaceId,
            [nodeId],
            sql,
            LANGUAGE_SAMPLE_REQUEST.page,
            LANGUAGE_SAMPLE_REQUEST.page_size,
          )
        : ['tokenizer-language-sample', nodeId, column],
    enabled: canFetchSample,
    staleTime: 60_000,
    /** Called by: TanStack Query to fetch sample rows for language detection. */
    queryFn: async () => {
      if (!workspaceId || !nodeId || !column) {
        throw new Error('Missing language-detection selection');
      }
      const data = await queryWorkspaceSqlTable({
        path: { workspace_id: workspaceId },
        body: {
          mode: 'query',
          node_ids: [nodeId],
          sql,
          page: LANGUAGE_SAMPLE_REQUEST.page,
          page_size: LANGUAGE_SAMPLE_REQUEST.page_size,
        },
      });
      return data;
    },
  });

  const sampleText = collectDocumentColumnText(sampleQuery.data?.rows, column ?? '');
  const sourceRevision = sampleQuery.data
    ? (sampleQuery.data.etag ?? `fetched:${String(sampleQuery.dataUpdatedAt)}`)
    : null;

  // The sampled resource revision is the cache dependency. Keeping the text
  // itself out of the key avoids retaining document content in query metadata.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const detectionQuery = useQuery({
    queryKey: queryKeys.detectedColumnLanguage(
      workspaceId ?? '',
      nodeId ?? '',
      column ?? '',
      sourceRevision ?? 'disabled',
    ),
    enabled: enabled && sampleText.length > 0 && sourceRevision !== null,
    staleTime: 5 * 60_000,
    retry: false,
    /** Called by: TanStack Query once sample text is available. */
    queryFn: () => detectLanguageIso6391(sampleText),
  });

  return {
    detectedLanguage: detectionQuery.data ?? null,
    isDetecting: sampleQuery.isFetching || detectionQuery.isFetching,
  };
}
