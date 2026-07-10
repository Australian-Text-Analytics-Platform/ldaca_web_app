import { useState, type ReactNode } from 'react';

import { joinNodesPreview } from '@/api';
import type {
  NodeColumnSelection,
  WorkspaceNodeLike,
} from '@/features/views/common/nodeSelectionTypes';
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type {
  JoinPreviewRequestPayload,
  JoinType,
  PreviewPagination,
  PreviewRow,
} from '../../types';
import { JOIN_TYPE_OPTIONS } from '../../types';
import {
  buildWorkspaceNodeMap,
  deriveNodeLabel,
  getNodeKey,
} from '../../utils/nodeMetadata';
import { dedupeNodeIds } from '@/features/workspace/common/utils/selectionUtils';
import { MAX_JOIN_NODES } from '../../types';

const DEFAULT_JOIN_PALETTE = ['#2563eb', '#dc2626'];

export interface JoinSubTabProps {
  selectedNodeIds: string[];
  selectedNodeColumns: Record<string, string>;
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeLike[];
  getColumnInfos: (node: WorkspaceNodeLike) => ColumnInfo[];
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

interface JoinColumnDraft {
  nodeId: string;
  columnsKey: string;
  value: string;
}

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

/**
 * Formats the shared-column notice shown below the selection panel. Join uses
 * it to nudge users toward matching columns without dumping long schema lists.
 * Used by: local callers in preprocessing/useJoinSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const describeSharedColumns = (count: number, columns: string[]): string => {
  const preview = columns.slice(0, 4).join(', ');
  const suffix = columns.length > 4 ? ', …' : '';
  const list = preview ? ` (${preview}${suffix})` : '';
  return `Found ${String(count)} shared column${count === 1 ? '' : 's'}${list}.`;
};

/**
 * Creates a stable key for the current column set used by draft preservation.
 * Used by: local callers in preprocessing/useJoinSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const columnsKey = (columns: string[]): string => columns.join('\0');

/**
 * Resolves the selected join column for one node, preserving a still-valid user
 * draft and otherwise falling back to the preferred shared/default column.
 * Used by: local callers in preprocessing/useJoinSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 * Flow: reject missing node or columns, validate the draft against the current column signature, then fall back to shared or first column.
 */
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

/**
 * Owns Join sub-tab state. The component consumes this hook for node pairing,
 * join-column choices, preview fetching, and apply controls.
 * Used by: usePreprocessingPreview hook, JoinSubTab module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: derive left/right nodes and columns, build join payloads, run preview/apply requests,
 * and keep auto-generated node names in sync with selections.
 */
export const useJoinSubTab = (props: JoinSubTabProps): UseJoinSubTabResult => {
  const {
    selectedNodeIds,
    selectedNodeColumns,
    currentWorkspaceId,
    workspaceNodes,
    getColumnInfos,
    joinNodes,
    isLoading,
    onAlert,
  } = props;

  const [joinLeftColumnDraft, setJoinLeftColumnDraft] = useState<JoinColumnDraft | null>(null);
  const [joinRightColumnDraft, setJoinRightColumnDraft] = useState<JoinColumnDraft | null>(null);
  const [joinType, setJoinType] = useState<JoinType>('left');
  const [joinNewNodeName, setJoinNewNodeName] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const workspaceNodeMap = buildWorkspaceNodeMap(workspaceNodes);

  const joinNodeIds = dedupeNodeIds(selectedNodeIds);
  const joinLeftNodeId = joinNodeIds[0] ?? '';
  const joinRightNodeId = joinNodeIds[1] ?? '';

  const joinSelectedNodes = (() => {
    return joinNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeLike => Boolean(node));
  })();

  /**
   * Reads available columns for a node selected in the join panel.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const getNodeColumnsForJoin = (nodeId: string): string[] => {
    const node = workspaceNodeMap.get(nodeId);
    return node ? getColumnInfos(node).map((column) => column.name) : [];
  };

  /**
   * Labels the left and right column selectors in the shared node panel.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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
  const preferredLeftColumn = leftColumns.includes(selectedNodeColumns[joinLeftNodeId] ?? '')
    ? selectedNodeColumns[joinLeftNodeId]
    : preferredJoinColumn;
  const preferredRightColumn = rightColumns.includes(selectedNodeColumns[joinRightNodeId] ?? '')
    ? selectedNodeColumns[joinRightNodeId]
    : preferredJoinColumn;
  const joinLeftColumn = needsColumns
    ? resolveJoinColumn(joinLeftNodeId, leftColumns, joinLeftColumnDraft, preferredLeftColumn)
    : '';
  const joinRightColumn = needsColumns
    ? resolveJoinColumn(joinRightNodeId, rightColumns, joinRightColumnDraft, preferredRightColumn)
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
    return JSON.stringify(joinPreviewRequest);
  })();

  /**
   * Adapts the generated join preview endpoint to the shared preprocessing
   * preview hook result shape.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: translate the request into generated-client query params, call the preview API,
   * and normalize rows/columns/pagination for the shared preview table.
   */
  const joinPreviewFetcher = async ({
    request,
    page,
    pageSize,
    signal,
  }: {
    request: JoinPreviewRequestPayload;
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => {
    const { data: response } = await joinNodesPreview({
      path: { workspace_id: request.workspaceId },
      query: {
        left_node_id: request.leftNodeId,
        right_node_id: request.rightNodeId,
        left_on: request.leftOn,
        right_on: request.rightOn,
        how: request.joinType,
        page,
        page_size: pageSize,
      },
      signal,
      throwOnError: true,
    });

    return {
      // response comes from the generated API client; guard defensively against a
      // malformed/empty payload that the typed contract does not capture.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      columns: Array.isArray(response?.columns) ? response.columns : [],
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
  } = usePreprocessingPreview<JoinPreviewRequestPayload>({
    request: joinPreviewRequest,
    signature: joinPreviewSignature,
    fetcher: joinPreviewFetcher,
  });

  /**
   * Updates preview rows-per-page for the join preview table.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleJoinPreviewPageSizeChange = (size: number) => {
    setJoinPreviewPageSize(size);
  };

  const readyMessage =
    joinConfigIssues || 'Select two data blocks and configure the join to view a preview.';

  /**
   * Persists the user's left/right join column override for the active schema.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleJoinColumnChange = (nodeId: string, column: string) => {
    if (nodeId === joinLeftNodeId) {
      setJoinLeftColumnDraft({ nodeId, columnsKey: columnsKey(leftColumns), value: column });
    } else if (nodeId === joinRightNodeId) {
      setJoinRightColumnDraft({ nodeId, columnsKey: columnsKey(rightColumns), value: column });
    }
  };

  /**
   * Placeholder color handler because join uses fixed left/right colors.
   * Called by: useJoinSubTab internal event, effect, or helper flow.
   */
  const handleJoinColorChange = () => undefined;

  /**
   * Applies the join with the current node pair, join type, selected columns,
   * and optional output name.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: validate join readiness, derive column arrays and output name, run the mutation,
   * and restore loading state.
   */
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
      await joinNodes(
        joinLeftNodeId,
        joinRightNodeId,
        joinType,
        leftColumns,
        rightColumns,
        requestedName,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error applying join';
      onAlert(`Error applying join: ${message}`);
    } finally {
      setIsJoining(false);
    }
  };

  /**
   * Packages join selection state for the shared preprocessing panel consumer.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const selectionPanel: JoinSelectionPanelConfig = {
    selectedNodes: joinSelectedNodes,
    nodeColumnSelections: joinNodeSelections,
    nodeColors: joinNodeColors,
    defaultPalette: DEFAULT_JOIN_PALETTE,
    maxCompare: MAX_JOIN_NODES,
    disabled: joinSelectedNodes.length < 2,
    statusMessage: !joinConfigReady && joinConfigIssues ? joinConfigIssues : null,
    columnLabelFn,
    onColumnChange: handleJoinColumnChange,
    onColorChange: handleJoinColorChange,
    // Lets the preprocessing input panel render column options from the hook's normalized
    // workspace-node map instead of reading raw node metadata itself.
    // Called by: useJoinSubTab object consumers because consumers need this callback at the object boundary instead of recreating it inline.
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
    !joinConfigReady ||
    !currentWorkspaceId ||
    isJoining ||
    isLoading.operations ||
    previewIsEmpty ||
    !!joinPreviewError;

  const applyDisabledReason: string | undefined = (() => {
    if (isJoining || isLoading.operations) return undefined;
    if (!joinConfigReady) return joinConfigIssues || 'Configure the join first';
    if (joinPreviewError)
      return 'Fix the error shown in Preview join output before adding to workspace';
    if (previewIsEmpty)
      return 'The current join produces no matching rows — adjust the join type or key columns';
    return undefined;
  })();

  /**
   * Wraps join type state so the return object exposes a named setter.
   * Called by: useJoinSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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
      columns: joinPreviewColumns,
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
