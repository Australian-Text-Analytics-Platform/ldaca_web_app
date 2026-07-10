import { useState } from 'react';
import { toast } from 'sonner';
import { createAnalysisTaskDetachment } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import type { SequentialChartModel } from './sequentialChartModel';

interface SequentialAnalysisDetachNode {
  id?: string;
  name?: string;
}

interface SequentialAnalysisDetachParams {
  currentWorkspaceId: string | null;
  resolveTaskId: () => Promise<string | null>;
  panelSelectedNodes: SequentialAnalysisDetachNode[];
  model: SequentialChartModel;
  requestedNodeName: string;
  queryClient: {
    invalidateQueries: (params: { queryKey: readonly unknown[] }) => Promise<unknown>;
  };
}

/**
 * Coordinates adding a selected sequential-analysis chart slice back into the workspace.
 *
 * Used by: SequentialAnalysisFeature.tsx.
 * Flow: derive visible group filters and a default node name, then expose the
 * detach action and pending state for the selected chart periods.
 */
export function useSequentialAnalysisDetach({
  currentWorkspaceId,
  resolveTaskId,
  panelSelectedNodes,
  model,
  requestedNodeName,
  queryClient,
}: SequentialAnalysisDetachParams) {
  const [isDetaching, setIsDetaching] = useState(false);

  const sourceName = panelSelectedNodes[0]?.name ?? panelSelectedNodes[0]?.id ?? 'data';
  const defaultNodeName = `${sourceName}_trend`;

  // Sends the selected periods and visible groups to the backend detach task.
  /**
   * Returned to `SequentialAnalysisFeature` by `useSequentialAnalysisDetach`.
   * Flow: validate the selection, resolve the source task, submit selected
   * periods/groups, invalidate workspace queries, and report the outcome.
   */
  const handleDetach = async () => {
    if (!currentWorkspaceId) return;
    if (!model.selection.canDetach) return;

    const taskId = await resolveTaskId();
    if (!taskId) {
      toast.error('No sequential analysis task available for add to workspace');
      return;
    }

    const trimmedRequestedName = requestedNodeName.trim();
    const newNodeName = trimmedRequestedName.length > 0 ? trimmedRequestedName : defaultNodeName;

    setIsDetaching(true);
    try {
      await createAnalysisTaskDetachment({
        body: {
          selected_periods: model.selection.selectedPeriods,
          ...(model.selection.visibleGroups
            ? { visible_groups: model.selection.visibleGroups }
            : {}),
          new_node_name: newNodeName,
        },
        path: { workspace_id: currentWorkspaceId, task_id: taskId },
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
