import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { textApi, type TopicModelingRequest, type TopicModelingDetachRequest, type TopicModelingDetachNodeOption } from '../../../../api/text';
import { workspacesApi } from '../../../../api/workspaces';
import { queryKeys } from '../../../../lib/queryKeys';
import { applySelectedColumnsToSnapshots } from '../../../../hooks/useSchemaManagement';
import {
  clearAnalysisTaskArtifacts,
  collectTaskIds,
  pruneTasksById,
} from '../../../../hooks/analysisTaskUtils';
import { analysisServerRequestLockQueryKey } from '../../common';

type NodeSelection = {
  id?: string;
  name?: string;
  columns?: unknown;
};

type NodeColumnSelection = {
  nodeId: string;
  column: string;
};

type TopicModelingResponseLike = {
  state?: 'running' | 'successful' | 'failed' | 'cancelled';
  message?: string;
  metadata?: { task_id?: string; [key: string]: unknown };
};

type TopicTaskStatusLike = {
  activeTaskId?: string | null;
};

type TopicTaskLike = {
  task_id?: string | null;
};

type Params = {
  currentWorkspaceId: string | null;
  panelNodeIds: string[];
  panelSelectedNodes: NodeSelection[];
  panelHasMissingColumns: boolean;
  effectiveNodeColumnSelections: NodeColumnSelection[];
  minTopicSize: number;
  useCtTfidf: boolean;
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (snapshots: Array<{ id: string; name: string; columns: string[] }>) => void;
  setIsRunning: (value: boolean) => void;
  runningRef: React.MutableRefObject<boolean>;
  setError: (value: string | null) => void;
  setResultSafely: (value: TopicModelingResponseLike | null) => void;
  result: TopicModelingResponseLike | null;
  localTopicModelingTaskId: string | null;
  setLocalTopicModelingTaskId: (value: string | null) => void;
  topicTaskStatus: TopicTaskStatusLike;
  topicRunningTask: TopicTaskLike | null;
  topicSuccessfulTask: TopicTaskLike | null;
  topicFailedTask: TopicTaskLike | null;
  unlockSelection: () => void;
  setNodeColumnSelections: (
    value: NodeColumnSelection[],
    options?: { replace?: boolean; persist?: boolean }
  ) => void;
  recomputeAutoColumns: () => void;
  setTasks: (updater: (prev: any[]) => any[]) => void;
  lastFetchedRef: React.MutableRefObject<{ taskId: string | null; state: 'successful' | 'failed' | null }>;
  resolveTopicModelingTaskId: () => Promise<string | null>;
  queryClient: { invalidateQueries: (params: { queryKey: readonly unknown[] }) => Promise<unknown> };
};

export function useTopicModelingTaskFlow({
  currentWorkspaceId,
  panelNodeIds,
  panelSelectedNodes,
  panelHasMissingColumns,
  effectiveNodeColumnSelections,
  minTopicSize,
  useCtTfidf,
  getAuthHeaders,
  lockWithSnapshots,
  setIsRunning,
  runningRef,
  setError,
  setResultSafely,
  result,
  localTopicModelingTaskId,
  setLocalTopicModelingTaskId,
  topicTaskStatus,
  topicRunningTask,
  topicSuccessfulTask,
  topicFailedTask,
  unlockSelection,
  setNodeColumnSelections,
  recomputeAutoColumns,
  setTasks,
  lastFetchedRef,
  resolveTopicModelingTaskId,
  queryClient,
}: Params) {
  const [isClearing, setIsClearing] = useState(false);
  const [isDetachLoading, setIsDetachLoading] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [detachNodeOptions, setDetachNodeOptions] = useState<TopicModelingDetachNodeOption[]>([]);
  const [selectedDetachColumns, setSelectedDetachColumns] = useState<Record<string, string[]>>({});

  const handleRun = useCallback(async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) return;
    if (runningRef.current) return;
    if (panelHasMissingColumns) {
      toast.error('Select a text column for all selected data blocks');
      return;
    }

    const requestNodeIds = panelNodeIds.slice(0, 2);
    lastFetchedRef.current = { taskId: null, state: null };
    setIsRunning(true);
    runningRef.current = true;
    setError(null);
    setResultSafely(null);

    try {
      const nodeColumns: Record<string, string> = {};
      effectiveNodeColumnSelections.forEach((selection) => {
        if (selection.column && requestNodeIds.includes(selection.nodeId)) {
          nodeColumns[selection.nodeId] = selection.column;
        }
      });

      const snapshotById = new Map<string, { id: string; name: string; columns: string[] }>(
        panelSelectedNodes
          .filter((node): node is NodeSelection & { id: string } => typeof node.id === 'string' && node.id.length > 0)
          .map((node) => [
            node.id,
            {
              id: node.id,
              name: String(node.name || node.id),
              columns: Array.isArray(node.columns)
                ? node.columns.filter((col): col is string => typeof col === 'string')
                : [],
            },
          ])
      );

      const lockSnapshots = requestNodeIds.map((id) => snapshotById.get(id) || {
        id,
        name: id,
        columns: [],
      });

      const normalizedSnapshots = applySelectedColumnsToSnapshots(lockSnapshots, nodeColumns);
      lockWithSnapshots(normalizedSnapshots);

      const req: TopicModelingRequest = {
        node_ids: requestNodeIds,
        node_columns: nodeColumns,
        min_topic_size: minTopicSize,
        use_ctfidf: useCtTfidf,
      };

      const res = await textApi.topicModeling(req, getAuthHeaders());
      setResultSafely(res as TopicModelingResponseLike);
      await queryClient.invalidateQueries({ queryKey: analysisServerRequestLockQueryKey('topic_modeling', currentWorkspaceId) });

      if (res.state === 'failed') {
        setIsRunning(false);
        runningRef.current = false;
      }

      if (res.state !== 'successful' && res.state !== 'running') {
        setError(res.message || 'Topic modeling failed');
      }
    } catch (error: any) {
      setError(error?.message || 'Error running topic modeling');
      setIsRunning(false);
      runningRef.current = false;
    }
  }, [
    currentWorkspaceId,
    panelNodeIds,
    panelHasMissingColumns,
    runningRef,
    lastFetchedRef,
    setIsRunning,
    setError,
    setResultSafely,
    effectiveNodeColumnSelections,
    panelSelectedNodes,
    lockWithSnapshots,
    minTopicSize,
    useCtTfidf,
    getAuthHeaders,
    queryClient,
  ]);

  const openDetachDialog = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    try {
      setIsDetachLoading(true);
      const resp = await textApi.getTopicModelingDetachOptions(taskId, getAuthHeaders());
      const nodes = resp?.data?.nodes ?? [];
      setDetachNodeOptions(nodes);
      const initialSelections: Record<string, string[]> = {};
      nodes.forEach((node) => {
        initialSelections[node.node_id] = (node.available_columns || []).filter(
          (col) => !(node.disabled_columns || []).includes(col)
        );
      });
      setSelectedDetachColumns(initialSelections);
      setDetachDialogOpen(true);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load topic detach options');
    } finally {
      setIsDetachLoading(false);
    }
  }, [currentWorkspaceId, resolveTopicModelingTaskId, getAuthHeaders]);

  const toggleDetachColumn = useCallback((nodeId: string, column: string, checked: boolean) => {
    setSelectedDetachColumns((prev) => {
      const current = new Set(prev[nodeId] || []);
      if (checked) current.add(column);
      else current.delete(column);
      return { ...prev, [nodeId]: Array.from(current) };
    });
  }, []);

  const handleDetachConfirm = useCallback(async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    const nodeIds = detachNodeOptions.map((node) => node.node_id);
    const hasSelections = nodeIds.every((nodeId) => (selectedDetachColumns[nodeId] || []).length > 0);
    if (!hasSelections) {
      toast.error('Please select at least one column for each node');
      return;
    }

    try {
      setIsDetaching(true);
      const payload: TopicModelingDetachRequest = {
        node_ids: nodeIds,
        selected_columns: selectedDetachColumns,
      };
      const resp = await textApi.topicModelingDetach(taskId, payload, getAuthHeaders());
      if (resp?.state !== 'successful') {
        throw new Error(resp?.message || 'Topic detach failed');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceGraph(currentWorkspaceId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceNodes(currentWorkspaceId) }),
      ]);

      setDetachDialogOpen(false);
      toast.success('Detached topic node(s) created');
    } catch (error: any) {
      toast.error(error?.message || 'Topic detach failed');
    } finally {
      setIsDetaching(false);
    }
  }, [
    currentWorkspaceId,
    resolveTopicModelingTaskId,
    detachNodeOptions,
    selectedDetachColumns,
    getAuthHeaders,
    queryClient,
  ]);

  const handleClear = useCallback(async () => {
    if (!currentWorkspaceId) return;

    setIsClearing(true);
    const taskIds = collectTaskIds([
      (result as any)?.metadata?.task_id,
      localTopicModelingTaskId,
      topicTaskStatus.activeTaskId,
      topicRunningTask?.task_id,
      topicSuccessfulTask?.task_id,
      topicFailedTask?.task_id,
    ]);

    try {
      const headers = getAuthHeaders();
      const resolvedTaskId = await resolveTopicModelingTaskId();
      const allTaskIds = collectTaskIds([...taskIds, resolvedTaskId]);

      await clearAnalysisTaskArtifacts({
        workspaceId: currentWorkspaceId,
        taskIds: allTaskIds,
        cancelTask: (_workspaceId, taskId) => workspacesApi.cancelTasks({ task_id: taskId }, headers),
        clearManagerTask: (_workspaceId, taskId) => workspacesApi.clearTasks({ task_id: taskId }, headers),
        clearAnalysisTask: (_workspaceId, taskId) => textApi.clearTask(taskId, headers),
        warnContext: 'topic-modeling',
      });
    } finally {
      setIsClearing(false);
      setResultSafely(null);
      unlockSelection();
      setIsRunning(false);
      runningRef.current = false;
      setLocalTopicModelingTaskId(null);
      lastFetchedRef.current = { taskId: null, state: null };
      setNodeColumnSelections([], { replace: true, persist: false });
      recomputeAutoColumns();
      setTasks((prev) =>
        Array.isArray(prev)
          ? pruneTasksById(
              prev,
              collectTaskIds([
                (result as any)?.metadata?.task_id,
                localTopicModelingTaskId,
                topicTaskStatus.activeTaskId,
                topicRunningTask?.task_id,
                topicSuccessfulTask?.task_id,
                topicFailedTask?.task_id,
              ])
            )
          : prev
      );
      void queryClient.invalidateQueries({ queryKey: analysisServerRequestLockQueryKey('topic_modeling', currentWorkspaceId) });
    }
  }, [
    currentWorkspaceId,
    result,
    localTopicModelingTaskId,
    topicTaskStatus.activeTaskId,
    topicRunningTask?.task_id,
    topicSuccessfulTask?.task_id,
    topicFailedTask?.task_id,
    getAuthHeaders,
    resolveTopicModelingTaskId,
    setResultSafely,
    unlockSelection,
    setIsRunning,
    runningRef,
    setLocalTopicModelingTaskId,
    lastFetchedRef,
    setNodeColumnSelections,
    recomputeAutoColumns,
    setTasks,
    queryClient,
  ]);

  return {
    handleRun,
    handleClear,
    openDetachDialog,
    toggleDetachColumn,
    handleDetachConfirm,
    isClearing,
    isDetachLoading,
    isDetaching,
    detachDialogOpen,
    setDetachDialogOpen,
    detachNodeOptions,
    selectedDetachColumns,
  };
}
