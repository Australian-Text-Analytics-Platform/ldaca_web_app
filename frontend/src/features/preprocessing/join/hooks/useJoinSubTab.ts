import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { nodesApi } from '../../../../api/nodes';
import type { NodeColumnSelection, WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type { JoinPreviewRequestPayload, JoinType, PreviewPagination, PreviewRow } from '../../types';
import { JOIN_TYPE_OPTIONS } from '../../types';
import { buildWorkspaceNodeMap, deriveNodeLabel, extractNodeColumns, getNodeKey } from '../../utils/nodeMetadata';

const DEFAULT_JOIN_PALETTE = ['#2563eb', '#dc2626'];
const MAX_JOIN_NODES = 2;

export interface JoinSubTabProps {
  selectedNodeIds: string[];
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeLike[];
  joinNodes: (
    leftNodeId: string,
    rightNodeId: string,
    joinType: JoinType,
    leftColumns: string[],
    rightColumns: string[],
    newNodeName?: string,
  ) => Promise<void>;
  isLoading: {
    operations: boolean;
  };
  onAlert: (message: string) => void;
}

interface JoinSelectionPanelConfig {
  selectedNodes: WorkspaceNodeLike[];
  nodeColumnSelections: NodeColumnSelection[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  maxCompare: number;
  disabled: boolean;
  originalCount: number;
  statusMessage: string | null;
  columnLabelFn: (node: WorkspaceNodeLike, index: number) => ReactNode;
  onColumnChange: (nodeId: string, column: string) => void;
  onColorChange: (nodeId: string, color: string) => void;
  getNodeColumns: (node: WorkspaceNodeLike) => string[];
}

interface JoinPreviewConfig {
  columns: string[];
  data: PreviewRow[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  readyMessage: string;
  page: number;
  pageSize: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSizeChange: (size: number) => void;
}

interface JoinApplyState {
  run: () => Promise<void>;
  disabled: boolean;
  isBusy: boolean;
}

export interface UseJoinSubTabResult {
  selectionPanel: JoinSelectionPanelConfig;
  sharedColumnsNotice: string | null;
  needsColumns: boolean;
  joinType: JoinType;
  setJoinType: (value: JoinType) => void;
  currentJoinTypeInfo?: (typeof JOIN_TYPE_OPTIONS)[number];
  joinNewNodeName: string;
  setJoinNewNodeName: (value: string) => void;
  joinNamePlaceholder: string;
  joinStatusMessage: string;
  joinConfigReady: boolean;
  joinConfigIssues: string;
  preview: JoinPreviewConfig;
  apply: JoinApplyState;
  showActivityTag: boolean;
}

const dedupeNodeIds = (nodeIds: string[]): string[] => {
  const seen = new Set<string>();
  return nodeIds.filter((nodeId) => {
    if (!nodeId || seen.has(nodeId)) return false;
    seen.add(nodeId);
    return true;
  });
};

const describeSharedColumns = (count: number, columns: string[]): string => {
  const preview = columns.slice(0, 4).join(', ');
  const suffix = columns.length > 4 ? ', …' : '';
  const list = preview ? ` (${preview}${suffix})` : '';
  return `Found ${count} shared column${count === 1 ? '' : 's'}${list}.`;
};

export const useJoinSubTab = (props: JoinSubTabProps): UseJoinSubTabResult => {
  const { selectedNodeIds, currentWorkspaceId, workspaceNodes, joinNodes, isLoading, onAlert } = props;

  const [joinLeftNodeId, setJoinLeftNodeId] = useState('');
  const [joinRightNodeId, setJoinRightNodeId] = useState('');
  const [joinLeftColumn, setJoinLeftColumn] = useState('');
  const [joinRightColumn, setJoinRightColumn] = useState('');
  const [joinType, setJoinType] = useState<JoinType>('left');
  const [joinNewNodeName, setJoinNewNodeName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const joinNameAutofillRef = useRef('');

  const workspaceNodeMap = useMemo(() => buildWorkspaceNodeMap(workspaceNodes), [workspaceNodes]);

  const uniqueSelectedNodeIds = useMemo(() => dedupeNodeIds(selectedNodeIds), [selectedNodeIds]);
  const joinNodeIds = useMemo(() => uniqueSelectedNodeIds.slice(0, MAX_JOIN_NODES), [uniqueSelectedNodeIds]);
  const joinOriginalCount = uniqueSelectedNodeIds.length;

  const joinSelectedNodes = useMemo(() => {
    return joinNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeLike => Boolean(node));
  }, [joinNodeIds, workspaceNodeMap]);

  const getNodeColumnsForJoin = useCallback((nodeId: string): string[] => {
    const node = workspaceNodeMap.get(nodeId);
    return extractNodeColumns(node);
  }, [workspaceNodeMap]);

  const columnLabelFn = useCallback((node: WorkspaceNodeLike) => {
    const nodeId = getNodeKey(node);
    if (nodeId === joinLeftNodeId) return 'Left column:';
    if (nodeId === joinRightNodeId) return 'Right column:';
    return 'Join column:';
  }, [joinLeftNodeId, joinRightNodeId]);

  const joinNodeSelections = useMemo<NodeColumnSelection[]>(() => {
    const selections: NodeColumnSelection[] = [];
    if (joinLeftNodeId) {
      selections.push({ nodeId: joinLeftNodeId, column: joinLeftColumn });
    }
    if (joinRightNodeId && joinRightNodeId !== joinLeftNodeId) {
      selections.push({ nodeId: joinRightNodeId, column: joinRightColumn });
    }
    return selections;
  }, [joinLeftNodeId, joinLeftColumn, joinRightNodeId, joinRightColumn]);

  const joinNodeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    if (joinLeftNodeId) colors[joinLeftNodeId] = DEFAULT_JOIN_PALETTE[0] ?? '#2563eb';
    if (joinRightNodeId) colors[joinRightNodeId] = DEFAULT_JOIN_PALETTE[1] ?? '#dc2626';
    return colors;
  }, [joinLeftNodeId, joinRightNodeId]);

  const needsColumns = joinType !== 'cross';

  const sharedColumns = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId) return [] as string[];
    const leftColumns = getNodeColumnsForJoin(joinLeftNodeId);
    const rightColumns = getNodeColumnsForJoin(joinRightNodeId);
    return leftColumns.filter((column) => rightColumns.includes(column));
  }, [joinLeftNodeId, joinRightNodeId, getNodeColumnsForJoin]);

  const joinConfigReady = Boolean(
    joinLeftNodeId &&
      joinRightNodeId &&
      joinLeftNodeId !== joinRightNodeId &&
      (!needsColumns || (joinLeftColumn && joinRightColumn)),
  );

  const joinConfigIssues = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId) {
      return 'Pick two nodes to configure a join.';
    }
    if (joinLeftNodeId === joinRightNodeId) {
      return 'Select two different nodes to join—joining a node to itself is not supported yet.';
    }
    if (needsColumns && (!joinLeftColumn || !joinRightColumn)) {
      return 'Choose the columns that should match between the two nodes.';
    }
    if (needsColumns && sharedColumns.length === 0) {
      return 'No matching column names detected. Select compatible columns manually or rename them to match.';
    }
    return '';
  }, [joinLeftNodeId, joinRightNodeId, needsColumns, joinLeftColumn, joinRightColumn, sharedColumns]);

  const joinStatusMessage = useMemo(() => {
    if (joinConfigReady) {
      const leftNode = workspaceNodeMap.get(joinLeftNodeId);
      const rightNode = workspaceNodeMap.get(joinRightNodeId);
      if (needsColumns) {
        return `Ready to join ${deriveNodeLabel(leftNode)} and ${deriveNodeLabel(rightNode)} on ${joinLeftColumn} = ${joinRightColumn}.`;
      }
      return `Ready to run a ${joinType} join between ${deriveNodeLabel(leftNode)} and ${deriveNodeLabel(rightNode)}.`;
    }
    return joinConfigIssues || 'Configure the join to preview results.';
  }, [joinConfigReady, needsColumns, workspaceNodeMap, joinLeftNodeId, joinRightNodeId, joinLeftColumn, joinRightColumn, joinType, joinConfigIssues]);

  const currentJoinTypeInfo = useMemo(
    () => JOIN_TYPE_OPTIONS.find((option) => option.value === joinType),
    [joinType],
  );

  const autoJoinName = useMemo(() => {
    if (!joinLeftNodeId || !joinRightNodeId || joinLeftNodeId === joinRightNodeId) return '';
    const leftNode = workspaceNodeMap.get(joinLeftNodeId);
    const rightNode = workspaceNodeMap.get(joinRightNodeId);
    const leftName = deriveNodeLabel(leftNode);
    const rightName = deriveNodeLabel(rightNode);
    if (!leftName || !rightName) return '';
    return `${leftName}_${joinType}_join_${rightName}`.replace(/\s+/g, '_');
  }, [joinLeftNodeId, joinRightNodeId, joinType, workspaceNodeMap]);

  useEffect(() => {
    joinNameAutofillRef.current = autoJoinName || '';
  }, [autoJoinName]);

  useEffect(() => {
    const nextLeft = joinNodeIds[0] ?? '';
    const nextRight = joinNodeIds[1] ?? '';
    setJoinLeftNodeId((prev) => (prev === nextLeft ? prev : nextLeft));
    setJoinRightNodeId((prev) => (prev === nextRight ? prev : nextRight));
  }, [joinNodeIds]);

  useEffect(() => {
    if (joinType === 'cross') {
      setJoinLeftColumn('');
      setJoinRightColumn('');
      return;
    }
    const leftColumns = joinLeftNodeId ? getNodeColumnsForJoin(joinLeftNodeId) : [];
    const rightColumns = joinRightNodeId ? getNodeColumnsForJoin(joinRightNodeId) : [];
    if (!leftColumns.length || !rightColumns.length) {
      setJoinLeftColumn('');
      setJoinRightColumn('');
      return;
    }
    const common = leftColumns.filter((column) => rightColumns.includes(column));
    setJoinLeftColumn((prev) => (prev && leftColumns.includes(prev) ? prev : common[0] ?? leftColumns[0] ?? ''));
    setJoinRightColumn((prev) => (prev && rightColumns.includes(prev) ? prev : common[0] ?? rightColumns[0] ?? ''));
  }, [joinLeftNodeId, joinRightNodeId, joinType, getNodeColumnsForJoin]);

  const joinPreviewRequest = useMemo<JoinPreviewRequestPayload | null>(() => {
    if (!currentWorkspaceId || !joinConfigReady) return null;
    return {
      workspaceId: currentWorkspaceId,
      leftNodeId: joinLeftNodeId,
      rightNodeId: joinRightNodeId,
      leftOn: needsColumns ? joinLeftColumn : undefined,
      rightOn: needsColumns ? joinRightColumn : undefined,
      joinType,
    };
  }, [currentWorkspaceId, joinConfigReady, joinLeftNodeId, joinRightNodeId, needsColumns, joinLeftColumn, joinRightColumn, joinType]);

  const joinPreviewSignature = useMemo(() => {
    if (!joinPreviewRequest) return 'join-preview-disabled';
    return JSON.stringify({
      leftNodeId: joinPreviewRequest.leftNodeId,
      rightNodeId: joinPreviewRequest.rightNodeId,
      leftOn: joinPreviewRequest.leftOn ?? null,
      rightOn: joinPreviewRequest.rightOn ?? null,
      joinType: joinPreviewRequest.joinType,
    });
  }, [joinPreviewRequest]);

  const joinPreviewFetcher = useCallback(async ({
    request,
    page,
    pageSize,
  }: {
    request: JoinPreviewRequestPayload;
    page: number;
    pageSize: number;
  }) => {
    const response = await nodesApi.joinPreview(
      request.workspaceId,
      {
        left_node_id: request.leftNodeId,
        right_node_id: request.rightNodeId,
        left_on: request.leftOn,
        right_on: request.rightOn,
        how: request.joinType,
      },
      page,
      pageSize,
    );

    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: response?.pagination ?? null,
    };
  }, []);

  const {
    data: joinPreviewData,
    columns: joinPreviewColumns,
    pagination: joinPreviewPagination,
    loading: joinPreviewLoading,
    error: joinPreviewError,
    ready: joinPreviewReady,
    page: joinPreviewPage,
    pageSize: joinPreviewPageSize,
    setPage: setJoinPreviewPage,
    setPageSize: setJoinPreviewPageSize,
  } = usePreprocessingPreview<JoinPreviewRequestPayload, PreviewRow>({
    request: joinPreviewRequest,
    signature: joinPreviewSignature,
    fetcher: joinPreviewFetcher,
  });

  const joinPreviewColumnsToRender = useMemo(() => {
    if (joinPreviewColumns.length > 0) return joinPreviewColumns;
    if (joinPreviewData.length > 0 && typeof joinPreviewData[0] === 'object' && joinPreviewData[0] !== null) {
      return Object.keys(joinPreviewData[0]);
    }
    return [];
  }, [joinPreviewColumns, joinPreviewData]);

  const handleJoinPreviewPrev = useCallback(() => {
    if (joinPreviewPagination?.has_prev && !joinPreviewLoading) {
      setJoinPreviewPage(Math.max(1, joinPreviewPage - 1));
    }
  }, [joinPreviewPagination, joinPreviewLoading, joinPreviewPage, setJoinPreviewPage]);

  const handleJoinPreviewNext = useCallback(() => {
    if (joinPreviewPagination?.has_next && !joinPreviewLoading) {
      setJoinPreviewPage(joinPreviewPage + 1);
    }
  }, [joinPreviewPagination, joinPreviewLoading, joinPreviewPage, setJoinPreviewPage]);

  const handleJoinPreviewPageSizeChange = useCallback((size: number) => {
    setJoinPreviewPageSize(size);
  }, [setJoinPreviewPageSize]);

  const readyMessage = joinConfigIssues || 'Select two nodes and configure the join to view a preview.';

  const handleJoinColumnChange = useCallback((nodeId: string, column: string) => {
    if (nodeId === joinLeftNodeId) {
      setJoinLeftColumn(column);
    } else if (nodeId === joinRightNodeId) {
      setJoinRightColumn(column);
    }
  }, [joinLeftNodeId, joinRightNodeId]);

  const handleJoinColorChange = useCallback(() => undefined, []);

  const handleApplyJoin = useCallback(async () => {
    if (!joinConfigReady) {
      onAlert('Please select two different nodes and matching columns to join.');
      return;
    }
    const leftColumns = needsColumns ? [joinLeftColumn] : [];
    const rightColumns = needsColumns ? [joinRightColumn] : [];
    const requestedName = joinNewNodeName.trim() || joinNameAutofillRef.current || undefined;
    try {
      setIsJoining(true);
      await joinNodes(joinLeftNodeId, joinRightNodeId, joinType, leftColumns, rightColumns, requestedName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying join';
      onAlert(`Error applying join: ${message}`);
    } finally {
      setIsJoining(false);
    }
  }, [joinConfigReady, needsColumns, joinLeftColumn, joinRightColumn, joinNewNodeName, joinNodes, joinLeftNodeId, joinRightNodeId, joinType, onAlert]);

  const selectionPanel: JoinSelectionPanelConfig = {
    selectedNodes: joinSelectedNodes,
    nodeColumnSelections: joinNodeSelections,
    nodeColors: joinNodeColors,
    defaultPalette: DEFAULT_JOIN_PALETTE,
    maxCompare: MAX_JOIN_NODES,
    disabled: joinSelectedNodes.length < 2,
    originalCount: joinOriginalCount,
    statusMessage: !joinConfigReady && joinConfigIssues ? joinConfigIssues : null,
    columnLabelFn,
    onColumnChange: handleJoinColumnChange,
    onColorChange: handleJoinColorChange,
    getNodeColumns: (node: WorkspaceNodeLike) => {
      const key = getNodeKey(node);
      return key ? getNodeColumnsForJoin(key) : [];
    },
  };

  const sharedColumnsNotice = useMemo(() => {
    if (!needsColumns) return null;
    if (!joinLeftNodeId || !joinRightNodeId || joinLeftNodeId === joinRightNodeId) return null;
    return sharedColumns.length > 0
      ? describeSharedColumns(sharedColumns.length, sharedColumns)
      : 'No matching column names detected. Select compatible columns manually.';
  }, [needsColumns, joinLeftNodeId, joinRightNodeId, sharedColumns]);

  const applyDisabled =
    !joinConfigReady || !currentWorkspaceId || isJoining || isLoading.operations;

  const handleSetJoinType = useCallback((value: JoinType) => {
    setJoinType(value);
  }, []);

  return {
    selectionPanel,
    sharedColumnsNotice,
    needsColumns,
    joinType,
    setJoinType: handleSetJoinType,
    currentJoinTypeInfo,
    joinNewNodeName,
    setJoinNewNodeName,
    joinNamePlaceholder: autoJoinName || 'Joined dataset',
    joinStatusMessage,
    joinConfigReady,
    joinConfigIssues,
    preview: {
      columns: joinPreviewColumnsToRender,
      data: joinPreviewData,
      pagination: joinPreviewPagination,
      loading: joinPreviewLoading,
      error: joinPreviewError,
      ready: joinPreviewReady,
      readyMessage,
      page: joinPreviewPage,
      pageSize: joinPreviewPageSize,
      onPreviousPage: handleJoinPreviewPrev,
      onNextPage: handleJoinPreviewNext,
      onPageSizeChange: handleJoinPreviewPageSizeChange,
    },
    apply: {
      run: handleApplyJoin,
      disabled: applyDisabled,
      isBusy: isJoining,
    },
    showActivityTag: isJoining || isLoading.operations,
  };
};

export type { JoinSelectionPanelConfig };