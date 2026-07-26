import { useInfiniteQuery } from '@tanstack/react-query';
import type { Analysis } from '@/api';
import { workspaceAnalysesQueryOptions } from '@/features/workspace/common/hooks/workspaceAnalysesQuery';

export interface TabAnalysisForest {
  analyses: Analysis[];
  previews: Analysis[];
  runAll: Analysis[];
  supporting: Analysis[];
  latestPreview: Analysis | null;
  latestRunAll: Analysis | null;
  active: Analysis | null;
  refresh: () => void;
}

const newest = (analyses: Analysis[]): Analysis | null =>
  analyses.reduce<Analysis | null>(
    (latest, analysis) =>
      latest === null || analysis.created_at > latest.created_at ? analysis : latest,
    null,
  );

/**
 * Projects one Tab-owned Analysis forest from the canonical Workspace Analysis
 * collection. No feature keeps a second task id or lifecycle cache.
 */
export function useTabAnalysisForest(workspaceId: string | null, tabId: string): TabAnalysisForest {
  const query = useInfiniteQuery({
    ...workspaceAnalysesQueryOptions(workspaceId),
    refetchInterval: (current) => {
      const items = current.state.data?.pages.flatMap((page) => page.items) ?? [];
      return items.some(
        (item) =>
          'request' in item &&
          item.tab_id === tabId &&
          (item.state === 'queued' || item.state === 'running'),
      )
        ? 1_000
        : false;
    },
  });
  const analyses = (query.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((item): item is Analysis => 'request' in item && item.tab_id === tabId)
    .toSorted((left, right) => left.created_at.localeCompare(right.created_at));
  const previews = analyses.filter((analysis) => analysis.execution_scope === 'preview');
  const runAll = analyses.filter((analysis) => analysis.execution_scope === 'run_all');
  const supporting = analyses.filter((analysis) => analysis.execution_scope === 'supporting');
  return {
    analyses,
    previews,
    runAll,
    supporting,
    latestPreview: newest(previews),
    latestRunAll: newest(runAll),
    active:
      analyses.find(
        (analysis) =>
          analysis.execution_scope !== 'supporting' &&
          (analysis.state === 'queued' || analysis.state === 'running'),
      ) ?? null,
    refresh: () => {
      void query.refetch();
    },
  };
}
