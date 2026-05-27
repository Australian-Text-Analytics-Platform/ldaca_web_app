import { useState, type ReactNode } from 'react';

import { joinNodesPreview } from '@/api/generated/sdk.gen';
import { useAuth } from '@/hooks/useAuth';
import type { NodeColumnSelection, WorkspaceNodeLike } from '@/features/analysis/common/components/NodeSelectionPanel';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type { JoinPreviewRequestPayload, JoinType, PreviewPagination, PreviewRow } from '../../types';
import { JOIN_TYPE_OPTIONS } from '../../types';
import { buildWorkspaceNodeMap, deriveNodeLabel, extractNodeColumns, getNodeKey } from '../../utils/nodeMetadata';
import { dedupeNodeIds, takeMostRecent } from '@/utils/selectionUtils';
import { MAX_JOIN_NODES } from '../../types';

const DEFAULT_JOIN_PALETTE = ['#2563eb', '#dc2626'];

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
  ) => Promise<unknown>;
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
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

type JoinColumnDraft = {
  nodeId: string;
  columnsKey: string;
  value: string;
};

interface JoinApplyState {
  run: () => Promise<void>;
  disabled: boolean;
  disabledReason: string | undefined;
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

const describeSharedColumns = (count: number, columns: string[]): string => {
  const preview = columns.slice(0, 4).join(', ');
  const suffix = columns.length > 4 ? ', …' : '';
  const list = preview ? ` (${preview}${suffix})` : '';
  return `Found ${count} shared column${count === 1 ? '' : 's'}${list}.`;
};

const columnsKey = (columns: string[]): string => columns.join('\0');

const resolveJoinColumn = (
  nodeId: string,
  columns: string[],
  draft: JoinColumnDraft | null,
  preferredColumn: string | undefined,
): string => {
  if (!nodeId || columns.length === 0) return '';
  const key = columnsKey(columns);
  if (draft?.nodeId === nodeId && draft.columnsKey === key && columns.includes(draft.value)) {
    return draft.value;
  }
  return preferredColumn ?? columns[0] ?? '';
};

export const useJoinSubTab = (props: JoinSubTabProps): UseJoinSubTabResult => {
  const { selectedNodeIds, currentWorkspaceId, workspaceNodes, joinNodes, isLoading, onAlert } = props;
  const { getAuthHeaders } = useAuth();

  const [joinLeftColumnDraft, setJoinLeftColumnDraft] = useState<JoinColumnDraft | null>(null);
  const [joinRightColumnDraft, setJoinRightColumnDraft] = useState<JoinColumnDraft | null>(null);
  const [joinType, setJoinType] = useState<JoinType>('left');
  const [joinNewNodeName, setJoinNewNodeName] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const workspaceNodeMap = buildWorkspaceNodeMap(workspaceNodes);

  const uniqueSelectedNodeIds = dedupeNodeIds(selectedNodeIds);
  const joinNodeIds = takeMostRecent(uniqueSelectedNodeIds, MAX_JOIN_NODES);
  const joinOriginalCount = uniqueSelectedNodeIds.length;
  const joinLeftNodeId = joinNodeIds[0] ?? '';
  const joinRightNodeId = joinNodeIds[1] ?? '';

  const joinSelectedNodes = (() => {
    return joinNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeLike => Boolean(node));
  })();

  const getNodeColumnsForJoin = (nodeId: string): string[] => {
    const node = workspaceNodeMap.get(nodeId);
    return extractNodeColumns(node);
  };

  const columnLabelFn = (node: WorkspaceNodeLike) => {
    const nodeId = getNodeKey(node);
    if (nodeId === joinLeftNodeId) return 'Left column:';
    if (nodeId === joinRightNodeId) return 'Right column:';
    return 'Join column:';
  };

  const joinNodeColors = (() => {
    const colors: Record<string, string> = {};
    if (joinLeftNodeId) colors[joinLeftNodeId] = DEFAULT_JOIN_PALETTE[0] ?? '#2563eb';
    if (joinRightNodeId) colors[joinRightNodeId] = DEFAULT_JOIN_PALETTE[1] ?? '#dc2626';
    return colors;
  })();

  const needsColumns = joinType !== 'cross';

  const leftColumns = joinLeftNodeId ? getNodeColumnsForJoin(joinLeftNodeId) : [];
  const rightColumns = joinRightNodeId ? getNodeColumnsForJoin(joinRightNodeId) : [];

  const sharedColumns = (() => {
    if (!joinLeftNodeId || !joinRightNodeId) return [] as string[];
    return leftColumns.filter((column) => rightColumns.includes(column));
  })();

  const preferredJoinColumn = sharedColumns[0];
  const joinLeftColumn = needsColumns
    ? resolveJoinColumn(joinLeftNodeId, leftColumns, joinLeftColumnDraft, preferredJoinColumn)
    : '';
  const joinRightColumn = needsColumns
    ? resolveJoinColumn(joinRightNodeId, rightColumns, joinRightColumnDraft, preferredJoinColumn)
    : '';

  const joinNodeSelections: NodeColumnSelection[] = (() => {
    const selections: NodeColumnSelection[] = [];
    if (joinLeftNodeId) {
      selections.push({ nodeId: joinLeftNodeId, column: joinLeftColumn });
    }
    if (joinRightNodeId && joinRightNodeId !== joinLeftNodeId) {
      selections.push({ nodeId: joinRightNodeId, column: joinRightColumn });
    }
    return selections;
  })();

  const joinConfigReady = Boolean(
    joinLeftNodeId &&
      joinRightNodeId &&
      joinLeftNodeId !== joinRightNodeId &&
      (!needsColumns || (joinLeftColumn && joinRightColumn)),
  );

  const joinConfigIssues = (() => {
    if (!joinLeftNodeId || !joinRightNodeId) {
      return 'Pick two data blocks to configure a join.';
    }
    if (joinLeftNodeId === joinRightNodeId) {
      return 'Select two different data blocks to join. Joining a data block to itself is not supported yet.';
    }
    if (needsColumns && (!joinLeftColumn || !joinRightColumn)) {
      return 'Choose the columns that should match between the two data blocks.';
    }
    if (needsColumns && sharedColumns.length === 0) {
      return 'No matching column names detected. Select compatible columns manually or rename them to match.';
    }
    return '';
  })();

  const joinStatusMessage = (() => {
    if (joinConfigReady) {
      const leftNode = workspaceNodeMap.get(joinLeftNodeId);
      const rightNode = workspaceNodeMap.get(joinRightNodeId);
      if (needsColumns) {
        return `Ready to join ${deriveNodeLabel(leftNode)} and ${deriveNodeLabel(rightNode)} on ${joinLeftColumn} = ${joinRightColumn}.`;
      }
      return `Ready to run a ${joinType} join between ${deriveNodeLabel(leftNode)} and ${deriveNodeLabel(rightNode)}.`;
    }
    return joinConfigIssues || 'Configure the join to preview results.';
  })();

  const currentJoinTypeInfo = JOIN_TYPE_OPTIONS.find((option) => option.value === joinType);

  const autoJoinName = (() => {
    if (!joinLeftNodeId || !joinRightNodeId || joinLeftNodeId === joinRightNodeId) return '';
    const leftNode = workspaceNodeMap.get(joinLeftNodeId);
    const rightNode = workspaceNodeMap.get(joinRightNodeId);
    const leftName = deriveNodeLabel(leftNode);
    const rightName = deriveNodeLabel(rightNode);
    if (!leftName || !rightName) return '';
    return `${leftName}_${joinType}_join_${rightName}`.replace(/\s+/g, '_');
  })();

  const joinPreviewRequest: JoinPreviewRequestPayload | null = (() => {
    if (!currentWorkspaceId || !joinConfigReady) return null;
    return {
      workspaceId: currentWorkspaceId,
      leftNodeId: joinLeftNodeId,
      rightNodeId: joinRightNodeId,
      leftOn: needsColumns ? joinLeftColumn : undefined,
      rightOn: needsColumns ? joinRightColumn : undefined,
      joinType,
    };
  })();

  const joinPreviewSignature = (() => {
    if (!joinPreviewRequest) return 'join-preview-disabled';
    return JSON.stringify({
      leftNodeId: joinPreviewRequest.leftNodeId,
      rightNodeId: joinPreviewRequest.rightNodeId,
      leftOn: joinPreviewRequest.leftOn ?? null,
      rightOn: joinPreviewRequest.rightOn ?? null,
      joinType: joinPreviewRequest.joinType,
    });
  })();

  const joinPreviewFetcher = async ({
    request,
    page,
    pageSize,
  }: {
    request: JoinPreviewRequestPayload;
    page: number;
    pageSize: number;
  }) => {
    const { data: response } = await joinNodesPreview({
      headers: getAuthHeaders(),
      query: {
        left_node_id: request.leftNodeId,
        right_node_id: request.rightNodeId,
        left_on: request.leftOn,
        right_on: request.rightOn,
        how: request.joinType,
        page,
        page_size: pageSize,
      },
      throwOnError: true,
    });

    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: response?.pagination ?? null,
    };
  };

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

  const joinPreviewColumnsToRender = (() => {
    if (joinPreviewColumns.length > 0) return joinPreviewColumns;
    if (joinPreviewData.length > 0 && typeof joinPreviewData[0] === 'object' && joinPreviewData[0] !== null) {
      return Object.keys(joinPreviewData[0]);
    }
    return [];
  })();

  const handleJoinPreviewPageSizeChange = (size: number) => {
    setJoinPreviewPageSize(size);
  };

  const readyMessage = joinConfigIssues || 'Select two data blocks and configure the join to view a preview.';

  const handleJoinColumnChange = (nodeId: string, column: string) => {
    if (nodeId === joinLeftNodeId) {
      setJoinLeftColumnDraft({ nodeId, columnsKey: columnsKey(leftColumns), value: column });
    } else if (nodeId === joinRightNodeId) {
      setJoinRightColumnDraft({ nodeId, columnsKey: columnsKey(rightColumns), value: column });
    }
  };

  const handleJoinColorChange = () => undefined;

  const handleApplyJoin = async () => {
    if (!joinConfigReady) {
      onAlert('Please select two different data blocks and matching columns to join.');
      return;
    }
    const leftColumns = needsColumns ? [joinLeftColumn] : [];
    const rightColumns = needsColumns ? [joinRightColumn] : [];
    const requestedName = joinNewNodeName.trim() || autoJoinName || undefined;
    try {
      setIsJoining(true);
      await joinNodes(joinLeftNodeId, joinRightNodeId, joinType, leftColumns, rightColumns, requestedName);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying join';
      onAlert(`Error applying join: ${message}`);
    } finally {
      setIsJoining(false);
    }
  };

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

  const sharedColumnsNotice = (() => {
    if (!needsColumns) return null;
    if (!joinLeftNodeId || !joinRightNodeId || joinLeftNodeId === joinRightNodeId) return null;
    return sharedColumns.length > 0
      ? describeSharedColumns(sharedColumns.length, sharedColumns)
      : 'No matching column names detected. Select compatible columns manually.';
  })();

  const previewIsEmpty =
    joinConfigReady &&
    joinPreviewReady &&
    !joinPreviewLoading &&
    !joinPreviewError &&
    (joinPreviewPagination !== null
      ? joinPreviewPagination.total_rows === 0
      : joinPreviewData.length === 0);

  const applyDisabled =
    !joinConfigReady || !currentWorkspaceId || isJoining || isLoading.operations || previewIsEmpty || !!joinPreviewError;

  const applyDisabledReason: string | undefined = (() => {
    if (isJoining || isLoading.operations) return undefined;
    if (!joinConfigReady) return joinConfigIssues || 'Configure the join first';
    if (joinPreviewError) return 'Fix the error shown in Preview join output before adding to workspace';
    if (previewIsEmpty) return 'The current join produces no matching rows — adjust the join type or key columns';
    return undefined;
  })();

  const handleSetJoinType = (value: JoinType) => {
    setJoinType(value);
  };

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
      onPageChange: setJoinPreviewPage,
      onPageSizeChange: handleJoinPreviewPageSizeChange,
    },
    apply: {
      run: handleApplyJoin,
      disabled: applyDisabled,
      disabledReason: applyDisabledReason,
      isBusy: isJoining,
    },
    showActivityTag: isJoining || isLoading.operations,
  };
};

export type { JoinSelectionPanelConfig };