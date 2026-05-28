import { useState } from 'react';
import { toast } from 'sonner';
import { detachSequentialAnalysisTask } from '@/api/generated/sdk.gen';
import { queryKeys } from '@/lib/queryKeys';
import type { SequentialAnalysisDatum } from './useSequentialAnalysisTaskFlow';

interface SequentialAnalysisDetachNode {
  id?: string;
  name?: string;
}

interface SequentialAnalysisDetachParams {
  currentWorkspaceId: string | null;
  resolveTaskId: () => Promise<string | null>;
  getAuthHeaders: () => Record<string, string>;
  panelSelectedNodes: SequentialAnalysisDetachNode[];
  chartData: SequentialAnalysisDatum[];
  results: Record<string, unknown> | null;
  excludedGroupKeys: Set<string>;
  selectedPeriodIndices: Set<number>;
  requestedNodeName: string;
  queryClient: {
    invalidateQueries: (params: { queryKey: readonly unknown[] }) => Promise<unknown>;
  };
}

/** Coordinates adding a selected sequential-analysis chart slice back into the workspace. */
/**
 * Used by: SequentialAnalysisFeature.tsx because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
export function useSequentialAnalysisDetach({
  currentWorkspaceId,
  resolveTaskId,
  getAuthHeaders,
  panelSelectedNodes,
  chartData,
  results,
  excludedGroupKeys,
  selectedPeriodIndices,
  requestedNodeName,
  queryClient,
}: SequentialAnalysisDetachParams) {
  const [isDetaching, setIsDetaching] = useState(false);

  const rawRows = Array.isArray(results?.data)
    ? (results.data as Array<Record<string, unknown>>)
    : [];
  const groupByColumns = Array.isArray((results?.analysis_params as Record<string, unknown> | undefined)?.group_by_columns)
    ? ((results?.analysis_params as Record<string, unknown>).group_by_columns as string[])
    : [];

  const visibleGroups = (() => {
    if (!groupByColumns.length || excludedGroupKeys.size === 0) return undefined;

    const dedupedVisibleGroups = new Map<string, Record<string, unknown>>();
    rawRows.forEach((row) => {
      const groupKey = groupByColumns.map((column) => String(row[column] ?? '')).join(' - ');
      if (excludedGroupKeys.has(groupKey)) {
        return;
      }

      const values = Object.fromEntries(groupByColumns.map((column) => [column, row[column] ?? null]));
      const dedupeKey = JSON.stringify(groupByColumns.map((column) => row[column] ?? null));
      dedupedVisibleGroups.set(dedupeKey, values);
    });

    return Array.from(dedupedVisibleGroups.values()).map((values) => ({ values }));
  })();

  const sourceName = String(panelSelectedNodes[0]?.name ?? panelSelectedNodes[0]?.id ?? 'data');
  const defaultNodeName = `${sourceName}_trend`;

  // Sends the selected periods and visible groups to the backend detach task.
  /**
   * Called by: useSequentialAnalysisDetach through JSX event props or task lifecycle callbacks because callers need shared hook state and handlers without duplicating analysis lifecycle wiring.
 * Flow: read caller config, derive local analysis state, call store/API helpers as needed, then return state and handlers to the feature.
 */
  const handleDetach = async () => {
    if (!currentWorkspaceId) return;
    if (selectedPeriodIndices.size === 0 || selectedPeriodIndices.size >= chartData.length) {
      return;
    }

    const taskId = await resolveTaskId();
    if (!taskId) {
      toast.error('No sequential analysis task available for add to workspace');
      return;
    }

    const selectedPeriods = Array.from(selectedPeriodIndices)
      .sort((left, right) => left - right)
      .map((index) => ({
        period_start: chartData[index]?.period_start,
        period_end: chartData[index]?.period_end,
      }))
      .filter((period) => period.period_start !== undefined && period.period_end !== undefined);

    if (selectedPeriods.length === 0) {
      toast.error('Selected periods are missing boundaries for filtering');
      return;
    }

    if (visibleGroups && visibleGroups.length === 0) {
      toast.error('No visible groups remain on the chart to add to the workspace');
      return;
    }

    const trimmedRequestedName = requestedNodeName.trim();
    const newNodeName = trimmedRequestedName.length > 0 ? trimmedRequestedName : defaultNodeName;

    setIsDetaching(true);
    try {
      await detachSequentialAnalysisTask({
        body: {
          selected_periods: selectedPeriods,
          ...(visibleGroups ? { visible_groups: visibleGroups } : {}),
          new_node_name: newNodeName,
        },
        headers: getAuthHeaders(),
        path: { task_id: taskId },
        throwOnError: true,
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(currentWorkspaceId) }),
      ]);

      toast.success(`Created "${newNodeName}" in workspace`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to add to workspace');
    } finally {
      setIsDetaching(false);
    }
  };

  return { handleDetach, isDetaching, defaultNodeName };
}