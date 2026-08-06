import { useEffect, useRef, useState, type ReactNode } from 'react';

import { previewNodeCreationTable } from '@/api';
import type { NodeColumnSelection } from '@/features/views/common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import type { ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type {
  JoinPreviewRequestPayload,
  JoinType,
  PreviewPagination,
  PreviewRow,
} from '../../types';
import { dedupeNodeIds } from '@/features/workspace/common/utils/selectionUtils';
import { MAX_JOIN_NODES } from '../../types';

const DEFAULT_JOIN_PALETTE = ['#2563eb', '#dc2626'];

export interface JoinSubTabProps {
  selectedNodeIds: string[];
  selectedNodeColumns: Record<string, string>;
  setSelectedNodeColumns: (columns: Record<string, string>) => void;
  currentWorkspaceId: string | null;
  workspaceNodes: WorkspaceNodeMetadata[];
  getColumnInfos: (node: WorkspaceNodeMetadata) => ColumnInfo[];
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
  onPreviewSuccess?: () => void;
  onAlert: (message: string) => void;
}

interface JoinSelectionPanelConfig {
  selectedNodes: WorkspaceNodeMetadata[];
  nodeColumnSelections: NodeColumnSelection[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  maxCompare: number;
  disabled: boolean;
  statusMessage: string | null;
  columnLabelFn: (node: WorkspaceNodeMetadata, index: number) => ReactNode;
  onColumnChange: (nodeId: string, column: string) => void;
  onColorChange: (nodeId: string, color: string) => void;
  getNodeColumns: (node: WorkspaceNodeMetadata) => string[];
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
  needsColumns: boolean;
  joinType: JoinType;
  setJoinType: (value: JoinType) => void;
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
 * Creates a stable key for the current column set used by draft preservation.
 * Called when storing and validating a join-column draft.
 */
const columnsKey = (columns: string[]): string => columns.join('\0');

/**
 * Resolves the selected join column for one node, preserving a still-valid user
 * draft and otherwise falling back to the preferred shared/default column.
 * Called for both join sides whenever node schemas or drafts change.
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
 * Used by `JoinSubTab` to own join selections, preview, and apply state.
 * Flow: derive left/right nodes and columns, build join payloads, run preview/apply requests,
 * and keep auto-generated node names in sync with selections.
 */
export const useJoinSubTab = (props: JoinSubTabProps): UseJoinSubTabResult => {
  const {
    selectedNodeIds,
    selectedNodeColumns,
    setSelectedNodeColumns,
    currentWorkspaceId,
    workspaceNodes,
    getColumnInfos,
    joinNodes,
    isLoading,
    onPreviewSuccess,
    onAlert,
  } = props;

  const [joinLeftColumnDraft, setJoinLeftColumnDraft] = useState<JoinColumnDraft | null>(null);
  const [joinRightColumnDraft, setJoinRightColumnDraft] = useState<JoinColumnDraft | null>(null);
  const [joinType, setJoinType] = useState<JoinType>('left');
  const [joinNewNodeName, setJoinNewNodeName] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const workspaceNodeMap = new Map(workspaceNodes.map((node) => [node.id, node]));

  const joinNodeIds = dedupeNodeIds(selectedNodeIds);
  const joinLeftNodeId = joinNodeIds[0] ?? '';
  const joinRightNodeId = joinNodeIds[1] ?? '';

  const joinSelectedNodes = (() => {
    return joinNodeIds
      .map((nodeId) => workspaceNodeMap.get(nodeId))
      .filter((node): node is WorkspaceNodeMetadata => Boolean(node));
  })();

  /**
   * Reads available columns for a node selected in the join panel.
   * Used to resolve both join sides and returned through `selectionPanel.getNodeColumns`.
   */
  const getNodeColumnsForJoin = (nodeId: string): string[] => {
    const node = workspaceNodeMap.get(nodeId);
    return node ? getColumnInfos(node).map((column) => column.name) : [];
  };

  /**
   * Labels the left and right column selectors in the shared node panel.
   * Returned through `selectionPanel.columnLabelFn`.
   */
  const columnLabelFn = (node: WorkspaceNodeMetadata) => {
    const nodeId = node.id;
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
  const joinPairSignature =
    joinLeftNodeId && joinRightNodeId && leftColumns.length > 0 && rightColumns.length > 0
      ? [joinLeftNodeId, joinRightNodeId, columnsKey(leftColumns), columnsKey(rightColumns)].join(
          '\0',
        )
      : '';
  const initializedJoinPairRef = useRef<string | null>(null);
  const selectedLeftColumn = selectedNodeColumns[joinLeftNodeId] ?? '';
  const selectedRightColumn = selectedNodeColumns[joinRightNodeId] ?? '';
  const defaultLeftColumn = leftColumns[0] ?? '';
  const defaultRightColumn = rightColumns[0] ?? '';

  useEffect(() => {
    if (!joinPairSignature) {
      initializedJoinPairRef.current = null;
      return;
    }
    if (initializedJoinPairRef.current === joinPairSignature) return;
    initializedJoinPairRef.current = joinPairSignature;
    if (!preferredJoinColumn) return;

    const alreadyUsesFirstShared =
      selectedLeftColumn === preferredJoinColumn && selectedRightColumn === preferredJoinColumn;
    const stillUsesInitialDefaults =
      (!selectedLeftColumn || selectedLeftColumn === defaultLeftColumn) &&
      (!selectedRightColumn || selectedRightColumn === defaultRightColumn);
    if (alreadyUsesFirstShared || !stillUsesInitialDefaults) return;

    setSelectedNodeColumns({
      [joinLeftNodeId]: preferredJoinColumn,
      [joinRightNodeId]: preferredJoinColumn,
    });
  }, [
    defaultLeftColumn,
    defaultRightColumn,
    joinLeftNodeId,
    joinPairSignature,
    joinRightNodeId,
    preferredJoinColumn,
    selectedLeftColumn,
    selectedRightColumn,
    setSelectedNodeColumns,
  ]);

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
        return `Ready to join ${leftNode?.name ?? ''} and ${rightNode?.name ?? ''} on ${joinLeftColumn} = ${joinRightColumn}.`;
      }
      return `Ready to run a ${joinType} join between ${leftNode?.name ?? ''} and ${rightNode?.name ?? ''}.`;
    }
    return joinConfigIssues || 'Configure the join to preview results.';
  })();

  const autoJoinName = (() => {
    if (!joinLeftNodeId || !joinRightNodeId || joinLeftNodeId === joinRightNodeId) return '';
    const leftNode = workspaceNodeMap.get(joinLeftNodeId);
    const rightNode = workspaceNodeMap.get(joinRightNodeId);
    const leftName = leftNode?.name ?? '';
    const rightName = rightNode?.name ?? '';
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

  /**
   * Adapts the generated join preview endpoint to the shared preprocessing
   * preview hook result shape.
   * Passed to `usePreprocessingPreviewState` as its request fetcher.
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
    const response = await previewNodeCreationTable({
      path: { workspace_id: request.workspaceId },
      body: {
        kind: 'join',
        left_node_id: request.leftNodeId,
        right_node_id: request.rightNodeId,
        left_on: request.leftOn,
        right_on: request.rightOn,
        how: request.joinType,
      },
      query: {
        page,
        page_size: pageSize,
      },
      signal,
    });
    onPreviewSuccess?.();
    return {
      data: response.rows as PreviewRow[],
      columns: response.columns,
      pagination: {
        page,
        page_size: pageSize,
        has_next: response.hasNext,
      },
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
    identity: joinPreviewRequest
      ? {
          workspaceId: joinPreviewRequest.workspaceId,
          operation: 'join',
          nodeIds: [joinPreviewRequest.leftNodeId, joinPreviewRequest.rightNodeId],
        }
      : null,
    fetcher: joinPreviewFetcher,
  });

  /**
   * Updates preview rows-per-page for the join preview table.
   * Returned as `preview.onPageSizeChange`.
   */
  const handleJoinPreviewPageSizeChange = (size: number) => {
    setJoinPreviewPageSize(size);
  };

  const readyMessage =
    joinConfigIssues || 'Select two data blocks and configure the join to view a preview.';

  /**
   * Persists the user's left/right join column override for the active schema.
   * Returned through `selectionPanel.onColumnChange`.
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
   * Returned through `selectionPanel.onColorChange` to satisfy the shared panel contract.
   */
  const handleJoinColorChange = () => undefined;

  /**
   * Applies the join with the current node pair, join type, selected columns,
   * and optional output name.
   * Returned as `apply.run` for `JoinSubTab`.
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
   * Returned to `JoinSubTab` as `selectionPanel`.
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
    // Invoked by the shared node-input panel for each selected join node.
    getNodeColumns: (node: WorkspaceNodeMetadata) => {
      return getNodeColumnsForJoin(node.id);
    },
  };

  const previewIsEmpty =
    joinConfigReady &&
    joinPreviewReady &&
    !joinPreviewLoading &&
    !joinPreviewError &&
    joinPreviewData.length === 0;

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
   * Returned to `JoinSubTab` as `setJoinType`.
   */
  const handleSetJoinType = (value: JoinType) => {
    setJoinType(value);
  };

  return {
    selectionPanel,
    needsColumns,
    joinType,
    setJoinType: handleSetJoinType,
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
