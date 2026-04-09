import { useState } from 'react';
import { toast } from 'sonner';
import {
  textApi,
  type TopicModelingRequest,
  type TopicModelingResponse,
  type TopicModelingDetachRequest,
  type TopicModelingDetachNodeOption,
} from '../../../../api/text';
import { queryKeys } from '../../../../lib/queryKeys';
import { restoreAnalysisLockFromRequest, extractAndSetTaskId } from '../../common';
import { takeMostRecent } from '../../../../utils/selectionUtils';

type NodeColumnSelection = {
  nodeId: string;
  column: string;
};

interface TopicModelingState {
  currentWorkspaceId: string | null;
  panelNodeIds: string[];
  panelHasMissingColumns: boolean;
  effectiveNodeColumnSelections: NodeColumnSelection[];
  minTopicSize: number;
  randomSeed: number;
  representativeWordsCount: number;
  selectedTopicIds: Set<number>;
}

interface TopicModelingActions {
  setIsRunning: (value: boolean) => void;
  runningRef: React.MutableRefObject<boolean>;
  setError: (value: string | null) => void;
  setResultSafely: (value: TopicModelingResponse | null) => void;
  lastFetchedRef: React.MutableRefObject<{ taskId: string | null; state: string | null }>;
  resolveTopicModelingTaskId: () => Promise<string | null>;
  setLocalTaskId: (id: string | null) => void;
}

interface TopicModelingLock {
  getAuthHeaders: () => Record<string, string>;
  lockWithSnapshots: (snapshots: Array<{ id: string; name?: string; columns?: string[] }>) => void;
  queryClient: { invalidateQueries: (params: { queryKey: readonly unknown[] }) => Promise<unknown> };
}

type Params = {
  state: TopicModelingState;
  actions: TopicModelingActions;
  lock: TopicModelingLock;
};

export function useTopicModelingTaskFlow({
  state: {
    currentWorkspaceId,
    panelNodeIds,
    panelHasMissingColumns,
    effectiveNodeColumnSelections,
    minTopicSize,
    randomSeed,
    representativeWordsCount,
    selectedTopicIds,
  },
  actions: {
    setIsRunning,
    runningRef,
    setError,
    setResultSafely,
    lastFetchedRef,
    resolveTopicModelingTaskId,
    setLocalTaskId,
  },
  lock: {
    getAuthHeaders,
    lockWithSnapshots,
    queryClient,
  },
}: Params) {
  const buildDetachNodeName = (nodeLabel: string, suffix: string) => {
    const trimmed = nodeLabel.trim();
    const base = trimmed.length > 0 ? trimmed : 'node';
    const normalized = base.replace(/\s+/g, '_');
    return `${normalized}${suffix}`;
  };

  const [isDetachLoading, setIsDetachLoading] = useState(false);
  const [isDetaching, setIsDetaching] = useState(false);
  const [detachDialogOpen, setDetachDialogOpen] = useState(false);
  const [detachNodeOptions, setDetachNodeOptions] = useState<TopicModelingDetachNodeOption[]>([]);
  const [selectedDetachColumns, setSelectedDetachColumns] = useState<Record<string, string[]>>({});

  const handleRun = async () => {
    if (!currentWorkspaceId || panelNodeIds.length === 0) return;
    if (runningRef.current) return;
    if (panelHasMissingColumns) {
      toast.error('Select a text column for all selected data blocks');
      return;
    }

    const requestNodeIds = takeMostRecent(panelNodeIds, 2);
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

      const req: TopicModelingRequest = {
        node_ids: requestNodeIds,
        node_columns: nodeColumns,
        min_topic_size: minTopicSize,
        random_seed: randomSeed,
        representative_words_count: representativeWordsCount,
      };

      try {
        if (req.node_ids.length) {
          await restoreAnalysisLockFromRequest({
            workspaceId: currentWorkspaceId,
            requestData: req,
            getAuthHeaders,
            lockWithSnapshots,
            maxNodes: 2,
          });
        }
      } catch {
        /* best effort lock */
      }

      const res = await textApi.topicModeling(req, getAuthHeaders());
      extractAndSetTaskId(res, setLocalTaskId);
      setResultSafely(res);

      if (res.state === 'failed') {
        setIsRunning(false);
        runningRef.current = false;
      }

      if (res.state !== 'successful' && res.state !== 'running') {
        setError(res.message || 'Topic modeling failed');
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Error running topic modeling');
      setIsRunning(false);
      runningRef.current = false;
    }
  };

  const openDetachDialog = async () => {
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
        initialSelections[node.node_id] = [];
      });
      setSelectedDetachColumns(initialSelections);
      setDetachDialogOpen(true);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load topic detach options');
    } finally {
      setIsDetachLoading(false);
    }
  };

  const toggleDetachColumn = (nodeId: string, column: string, checked: boolean) => {
    setSelectedDetachColumns((prev) => {
      const current = new Set(prev[nodeId] || []);
      if (checked) current.add(column);
      else current.delete(column);
      return { ...prev, [nodeId]: Array.from(current) };
    });
  };

  const selectAllDetachColumns = () => {
    setSelectedDetachColumns((prev) => {
      const next = { ...prev };
      detachNodeOptions.forEach((node) => {
        next[node.node_id] = node.available_columns.filter(
          (column) => !(node.disabled_columns || []).includes(column)
        );
      });
      return next;
    });
  };

  const deselectAllDetachColumns = () => {
    setSelectedDetachColumns((prev) => {
      const next = { ...prev };
      detachNodeOptions.forEach((node) => {
        next[node.node_id] = [];
      });
      return next;
    });
  };

  const handleDetachConfirm = async () => {
    if (!currentWorkspaceId) return;
    const taskId = await resolveTopicModelingTaskId();
    if (!taskId) {
      toast.error('No topic modeling task available for detach');
      return;
    }

    const nodeIds = detachNodeOptions.map((node) => node.node_id);

    try {
      setIsDetaching(true);
      const newNodeNames = Object.fromEntries(
        detachNodeOptions.map((node) => [
          node.node_id,
          buildDetachNodeName(String(node.node_name || node.node_id), '_topic'),
        ])
      );
      const payload: TopicModelingDetachRequest = {
        node_ids: nodeIds,
        selected_columns: selectedDetachColumns,
        new_node_names: newNodeNames,
        ...(selectedTopicIds.size > 0 ? { topic_ids: Array.from(selectedTopicIds) } : {}),
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
      toast.success('Detached topic data block(s) created');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Topic detach failed');
    } finally {
      setIsDetaching(false);
    }
  };

  return {
    handleRun,
    openDetachDialog,
    toggleDetachColumn,
    selectAllDetachColumns,
    deselectAllDetachColumns,
    handleDetachConfirm,
    isDetachLoading,
    isDetaching,
    detachDialogOpen,
    setDetachDialogOpen,
    detachNodeOptions,
    selectedDetachColumns,
  };
}
