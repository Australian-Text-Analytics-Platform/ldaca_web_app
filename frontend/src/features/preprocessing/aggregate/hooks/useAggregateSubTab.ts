import { useEffect, useRef, useState } from 'react';

import type { WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import {
  nodesApi,
  type ExpressionApplyResponse,
  type FilterPreviewResponse,
  type ExpressionTransformRequest,
} from '../../../../api/nodes';
import { mapColumnsToInfo } from '../../../../utils/columnTypes';
import { usePreprocessingPreview } from '../../hooks/usePreprocessingPreview';
import type { PreviewPagination, PreviewRow } from '../../types';

const DEFAULT_PALETTE = ['#2563eb'];

const SMART_CHAR_MAP: Record<string, string> = {
  '\u201C': '"', // "
  '\u201D': '"', // "
  '\u201E': '"', // „
  '\u201F': '"', // ‟
  '\u2018': "'", // '
  '\u2019': "'", // '
  '\u201A': "'", // ‚
  '\u201B': "'", // ‛
};

const normalizeSmartCharacters = (input: string): string =>
  input.replace(/[\u201C\u201D\u201E\u201F\u2018\u2019\u201A\u201B]/g, (char) => SMART_CHAR_MAP[char] ?? char);

export type BasicToken =
  | { id: string; kind: 'column'; column: string }
  | { id: string; kind: 'custom'; value: string };

export type DropIndicator = { tokenId: string; position: 'before' | 'after' };

export type DragPayload =
  | { source: 'palette'; kind: 'column'; column: string }
  | { source: 'palette'; kind: 'custom' }
  | { source: 'existing'; id: string };

export interface AggregateSubTabProps {
  selectedNodeId: string | null;
  selectedNodes: WorkspaceNodeLike[];
  workspaceNodes: WorkspaceNodeLike[];
  isLoading: {
    nodeData: boolean;
    graph: boolean;
    operations: boolean;
  };
  onAlert: (message: string) => void;
  computeColumnPreview: (nodeId: string, request: ExpressionTransformRequest, page?: number, pageSize?: number) => Promise<FilterPreviewResponse>;
  computeColumn: (nodeId: string, request: ExpressionTransformRequest) => Promise<ExpressionApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

export interface NodeSelectionConfig {
  effectiveNodes: WorkspaceNodeLike[];
  nodeColumnSelections: Array<{ nodeId: string; column: string }>;
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  originalCount: number;
}

export interface ExpressionConfig {
  mode: 'basic' | 'advanced';
  setMode: (mode: 'basic' | 'advanced') => void;
  expression: string;
  setExpression: (value: string) => void;
  columnName: string;
  setColumnName: (value: string) => void;
  focused: {
    expression: boolean;
    columnName: boolean;
  };
  onExpressionFocus: () => void;
  onExpressionBlur: () => void;
  onColumnNameFocus: () => void;
  onColumnNameBlur: () => void;
  onChange: {
    expression: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
    columnName: (event: React.ChangeEvent<HTMLInputElement>) => void;
  };
}

export interface BasicBuilderConfig {
  tokens: BasicToken[];
  disabled: boolean;
  dragActive: boolean;
  dropIndicator: DropIndicator | null;
  editingTokenId: string | null;
  customDraft: string;
  expressionPreview: string;
  availableColumns: string[];
  addColumnToken: (column: string, index?: number) => void;
  addCustomToken: (index?: number) => void;
  removeToken: (tokenId: string) => void;
  moveToken: (tokenId: string, index: number) => void;
  startEditingCustom: (tokenId: string) => void;
  finishCustomEdit: (commit: boolean) => void;
  clearBuilder: () => void;
  dropZoneRef: React.RefObject<HTMLDivElement | null>;
  handlers: {
    customDraftChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    customInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    columnDragStart: (event: React.DragEvent<HTMLButtonElement>, column: string) => void;
    customDragStart: (event: React.DragEvent<HTMLButtonElement>) => void;
    existingTokenDragStart: (event: React.DragEvent<HTMLDivElement>, tokenId: string) => void;
    existingTokenDragEnd: () => void;
    paletteDragEnd: () => void;
    tokenDragOver: (tokenId: string, event: React.DragEvent<HTMLDivElement>) => void;
    builderDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    builderDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
    builderDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  };
}

export interface PreviewConfig {
  data: PreviewRow[];
  columns: string[];
  pagination: PreviewPagination | null;
  loading: boolean;
  error: string | null;
  ready: boolean;
  readyMessage: string;
  page: number;
  pageSize: number;
  setPageSize: (size: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

export interface ApplyConfig {
  loading: boolean;
  canApply: boolean;
  lastAppliedExpression: string | null;
  currentMatchesApplied: boolean;
  handleApply: () => Promise<void>;
}

export interface UseAggregateSubTabResult {
  activeNodeId: string | null;
  hasSelection: boolean;
  nodeSelection: NodeSelectionConfig;
  expression: ExpressionConfig;
  basicBuilder: BasicBuilderConfig;
  preview: PreviewConfig;
  apply: ApplyConfig;
  manualExpressionActive: boolean;
  dropZoneRef: React.RefObject<HTMLDivElement | null>;
}

const createTokenId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `token-${Math.random().toString(36).slice(2, 10)}`;
};

export const useAggregateSubTab = (props: AggregateSubTabProps): UseAggregateSubTabResult => {
  const {
    selectedNodeId,
    selectedNodes,
    workspaceNodes,
    isLoading,
    onAlert,
    computeColumnPreview,
    computeColumn,
    refreshNodeSchema,
  } = props;

  const effectiveNodes = (() => {
    if (selectedNodes?.length) {
      return selectedNodes.slice(0, 1);
    }
    if (selectedNodeId) {
      const fallback = workspaceNodes.find((node, idx) => {
        const identifier =
          node.id ||
          node.node_id ||
          `node-${idx}`;
        return identifier === selectedNodeId;
      });
      if (fallback) {
        return [fallback];
      }
    }
    return [] as WorkspaceNodeLike[];
  })();

  const limitedNodeId = (() => {
    if (!effectiveNodes.length) return null;
    const first = effectiveNodes[0];
    return (
      first.id ||
      first.node_id ||
      null
    );
  })();

  const [expression, setExpression] = useState('');
  const [columnName, setColumnName] = useState('');
  const [applyLoading, setApplyLoading] = useState(false);
  const [lastAppliedExpression, setLastAppliedExpression] = useState<string | null>(null);
  const [expressionFocused, setExpressionFocused] = useState(false);
  const [columnNameFocused, setColumnNameFocused] = useState(false);
  const [expressionMode, setExpressionMode] = useState<'basic' | 'advanced'>('basic');
  const [basicTokens, setBasicTokens] = useState<BasicToken[]>([]);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [basicDragActive, setBasicDragActive] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState<string | null>(null);
  const [customDraft, setCustomDraft] = useState('');
  const [committedExpression, setCommittedExpression] = useState('');
  const [committedColumnName, setCommittedColumnName] = useState('');

  const customOriginalRef = useRef<string>('');
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const latestExpressionRef = useRef('');
  const latestColumnNameRef = useRef('');
  const lastDragPayloadRef = useRef<DragPayload | null>(null);

  useEffect(() => {
    setLastAppliedExpression(null);
    setBasicTokens([]);
    setEditingTokenId(null);
    setDropIndicator(null);
    setBasicDragActive(false);
    setCustomDraft('');
    setCommittedExpression('');
    setCommittedColumnName('');
  }, [limitedNodeId, selectedNodeId]);

  useEffect(() => {
    latestExpressionRef.current = expression;
  }, [expression]);

  useEffect(() => {
    latestColumnNameRef.current = columnName;
  }, [columnName]);

  useEffect(() => {
    if (expressionMode === 'advanced') {
      setEditingTokenId(null);
      setDropIndicator(null);
      setBasicDragActive(false);
    }
  }, [expressionMode]);

  const workspaceNodeMap = (() => {
    const map = new Map<string, WorkspaceNodeLike>();
    workspaceNodes.forEach((node, idx) => {
      const id = node.id || node.node_id || `node-${idx}`;
      if (id) map.set(id, node);
    });
    return map;
  })();

  const effectiveSelectedNodes = (() => {
    if (!limitedNodeId) return [] as WorkspaceNodeLike[];
    const node = workspaceNodeMap.get(limitedNodeId);
    return node ? [node] : [];
  })();

  const activeNodeId = (() => {
    return limitedNodeId ?? selectedNodeId ?? null;
  })();

  const hasSelection = Boolean(activeNodeId);
  const trimmedExpression = latestExpressionRef.current.trim();
  const canApply = hasSelection && trimmedExpression.length > 0 && !applyLoading && !isLoading.operations;
  const basicDisabled = !hasSelection || isLoading.operations;

  const availableColumns = (() => {
    if (!effectiveSelectedNodes.length) return [] as string[];
    const [node] = effectiveSelectedNodes;
    return mapColumnsToInfo(node)
      .map((info) => info.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
  })();

  const formatColumnName = (name: string) => {
    if (!name) return '';
    const safe = name.replace(/"/g, '\\"');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return name;
    }
    return `"${safe}"`;
  };

  const escapeLiteralValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const formatCustomToken = (rawValue: string) => {
      if (!rawValue.length) {
        return '""';
      }
      const trimmed = rawValue.trim();
      if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
      ) {
        return trimmed;
      }
      return `"${escapeLiteralValue(rawValue)}"`;
    };

  const tokensToExpression = (tokens: BasicToken[]) =>
      tokens
        .map((token) => {
          if (token.kind === 'column') {
            return formatColumnName(token.column);
          }
          return formatCustomToken(token.value);
        })
        .join(' + ');

  const setExpressionAndMarkDirty = (nextExpression: string) => {
    const normalizedExpression = normalizeSmartCharacters(nextExpression);
    latestExpressionRef.current = normalizedExpression;
    setExpression(normalizedExpression);
  };

  const applyBasicTokenUpdate = (updater: (prev: BasicToken[]) => BasicToken[]) => {
      setBasicTokens((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        const sameOrder = next.length === prev.length && next.every((token, idx) => token === prev[idx]);
        const nextExpression = tokensToExpression(next);
        if (sameOrder && nextExpression === trimmedExpression) {
          return prev;
        }
        setExpressionAndMarkDirty(nextExpression);
        return sameOrder ? prev : next;
      });
    };

  const buildRequest = (): ExpressionTransformRequest => {
    const expressionValue = latestExpressionRef.current.trim();
    const columnValue = latestColumnNameRef.current.trim();
    const payload: ExpressionTransformRequest = { expression: expressionValue };
    if (columnValue.length > 0) payload.new_column_name = columnValue;
    return payload;
  };

  const commitExpression = () => {
    setCommittedExpression(latestExpressionRef.current.trim());
    setCommittedColumnName(latestColumnNameRef.current.trim());
  };

  const commitTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (commitTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(commitTimeoutRef.current);
      }
    },
    [],
  );

  const scheduleCommit = () => {
    if (!hasSelection) return;
    if (typeof window === 'undefined') return;
    if (commitTimeoutRef.current) {
      window.clearTimeout(commitTimeoutRef.current);
    }
    commitTimeoutRef.current = window.setTimeout(() => {
      commitTimeoutRef.current = null;
      commitExpression();
    }, 250);
  };

  interface AggregatePreviewRequest {
    nodeId: string;
    payload: ExpressionTransformRequest | null;
  }

  const aggregatePreviewRequest: AggregatePreviewRequest | null = (() => {
    if (!hasSelection || !activeNodeId) return null;
    if (committedExpression.length === 0) return { nodeId: activeNodeId, payload: null };
    const payload: ExpressionTransformRequest = { expression: committedExpression };
    if (committedColumnName.length > 0) payload.new_column_name = committedColumnName;
    return { nodeId: activeNodeId, payload };
  })();

  const previewSignature = (() => {
    if (!aggregatePreviewRequest) return 'aggregate-preview-disabled';
    if (!aggregatePreviewRequest.payload) return `${aggregatePreviewRequest.nodeId}::raw`;
    return `${aggregatePreviewRequest.nodeId}::${JSON.stringify(aggregatePreviewRequest.payload)}`;
  })();

  const previewFetcher = async ({
    request,
    page,
    pageSize,
  }: {
    request: AggregatePreviewRequest;
    page: number;
    pageSize: number;
    signal: AbortSignal;
  }) => {
    if (request.payload) {
      const response = await computeColumnPreview(request.nodeId, request.payload, page, pageSize);
      return {
        data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
        columns: Array.isArray(response?.columns) ? response.columns : [],
        pagination: (response?.pagination as PreviewPagination) ?? null,
      };
    }
    const response = await nodesApi.data(request.nodeId, page, pageSize);
    return {
      data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
      columns: Array.isArray(response?.columns) ? response.columns : [],
      pagination: (response?.pagination as PreviewPagination) ?? null,
    };
  };

  const {
    data: previewData,
    columns: previewColumns,
    pagination: previewPagination,
    loading: previewLoading,
    error: previewError,
    page: previewPage,
    pageSize: previewPageSize,
    setPage: setPreviewPage,
    setPageSize: setPreviewPageSize,
    refresh: refreshPreview,
  } = usePreprocessingPreview({
    request: aggregatePreviewRequest,
    signature: previewSignature,
    fetcher: previewFetcher,
    debounceMs: 100,
  });

  const currentPreviewPage = previewPagination?.page ?? previewPage;

  const handlePreviewPrev = () => {
    if (previewPagination?.has_prev && !previewLoading) {
      setPreviewPage(Math.max(1, currentPreviewPage - 1));
    }
  };

  const handlePreviewNext = () => {
    if (previewPagination?.has_next && !previewLoading) {
      setPreviewPage(currentPreviewPage + 1);
    }
  };

  const clampIndex = (value: number, max: number) => {
    if (Number.isNaN(value)) return max;
    if (value < 0) return 0;
    if (value > max) return max;
    return value;
  };

  const addColumnToken = (column: string, index?: number) => {
      if (basicDisabled || !column) return;
      applyBasicTokenUpdate((prev) => {
        const next = [...prev];
        const insertIndex = clampIndex(index ?? next.length, next.length);
        next.splice(insertIndex, 0, { id: createTokenId(), kind: 'column', column });
        return next;
      });
      scheduleCommit();
    };

  const addCustomToken = (index?: number) => {
      if (basicDisabled) return;
      const tokenId = createTokenId();
      applyBasicTokenUpdate((prev) => {
        const next = [...prev];
        const insertIndex = clampIndex(index ?? next.length, next.length);
        next.splice(insertIndex, 0, { id: tokenId, kind: 'custom', value: '' });
        return next;
      });
      setEditingTokenId(tokenId);
      setCustomDraft('');
      customOriginalRef.current = '';
    };

  const removeBasicToken = (tokenId: string) => {
      if (basicDisabled) return;
      applyBasicTokenUpdate((prev) => {
        const idx = prev.findIndex((token) => token.id === tokenId);
        if (idx === -1) return prev;
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      });
      scheduleCommit();
    };

  const moveBasicToken = (tokenId: string, index: number) => {
      if (basicDisabled) return;
      applyBasicTokenUpdate((prev) => {
        const currentIndex = prev.findIndex((token) => token.id === tokenId);
        if (currentIndex === -1) return prev;
        const next = [...prev];
        const [item] = next.splice(currentIndex, 1);
        let targetIndex = clampIndex(index, next.length + 1);
        if (currentIndex < targetIndex) {
          targetIndex -= 1;
        }
        if (targetIndex === currentIndex) {
          return prev;
        }
        next.splice(targetIndex, 0, item);
        return next;
      });
      scheduleCommit();
    };

  const startEditingCustomToken = (tokenId: string) => {
      if (basicDisabled) return;
      const target = basicTokens.find(
        (token): token is Extract<BasicToken, { kind: 'custom' }> => token.id === tokenId && token.kind === 'custom',
      );
      if (!target) return;
      const normalizedValue = normalizeSmartCharacters(target.value);
      setEditingTokenId(tokenId);
      setCustomDraft(normalizedValue);
      customOriginalRef.current = normalizedValue;
    };

  const finishCustomEdit = (commit: boolean) => {
      if (!editingTokenId) {
        setCustomDraft('');
        return;
      }
      if (commit) {
        const nextValue = customDraft;
        applyBasicTokenUpdate((prev) =>
          prev.map((token) => {
            if (token.id === editingTokenId && token.kind === 'custom') {
              if (token.value === nextValue) {
                return token;
              }
              return { ...token, value: nextValue };
            }
            return token;
          }),
        );
        scheduleCommit();
      } else {
        setCustomDraft(customOriginalRef.current);
      }
      setEditingTokenId(null);
      setCustomDraft('');
    };

  const clearBasicBuilder = () => {
    if (basicDisabled) return;
    if (basicTokens.length === 0) {
      setExpressionAndMarkDirty('');
      scheduleCommit();
      return;
    }
    applyBasicTokenUpdate(() => []);
    scheduleCommit();
  };

  const parseDragPayload = (event: React.DragEvent): DragPayload | null => {
      const decode = (raw: string | null | undefined): DragPayload | null => {
        if (!raw) return null;
        try {
          const candidate = JSON.parse(raw) as DragPayload;
          return candidate && typeof candidate === 'object' ? candidate : null;
        } catch {
          return null;
        }
      };

      const dt = event.dataTransfer;
      if (dt) {
        const BASIC_TOKEN_MIME = 'application/x-ldaca-builder-token';
        const direct = decode(dt.getData(BASIC_TOKEN_MIME));
        if (direct) return direct;

        const jsonDecoded = decode(dt.getData('application/json'));
        if (jsonDecoded) return jsonDecoded;

        const plainDecoded = decode(dt.getData('text/plain'));
        if (plainDecoded) return plainDecoded;
      }

      return lastDragPayloadRef.current;
    };

  const setDragPayload = (dataTransfer: DataTransfer, payload: DragPayload, plainText: string): void => {
    const BASIC_TOKEN_MIME = 'application/x-ldaca-builder-token';
    const encoded = JSON.stringify(payload);
    try {
      dataTransfer.setData(BASIC_TOKEN_MIME, encoded);
    } catch {
      /* WebViews may reject custom MIME types */
    }
    try {
      dataTransfer.setData('application/json', encoded);
    } catch {
      /* Some environments disallow registering JSON mime types */
    }
    try {
      dataTransfer.setData('text/plain', plainText);
    } catch {
      /* Ignore environments that disallow overriding text/plain */
    }
  };

  const handleColumnDragStart = (event: React.DragEvent<HTMLButtonElement>, column: string) => {
      if (basicDisabled) {
        event.preventDefault();
        return;
      }
      const dt = event.dataTransfer;
      if (!dt) return;
      const payload: DragPayload = { source: 'palette', kind: 'column', column };
      lastDragPayloadRef.current = payload;
      setDragPayload(dt, payload, column);
      dt.effectAllowed = 'copy';
      setBasicDragActive(true);
    };

  const handleCustomDragStart = (event: React.DragEvent<HTMLButtonElement>) => {
      if (basicDisabled) {
        event.preventDefault();
        return;
      }
      const dt = event.dataTransfer;
      if (!dt) return;
      const payload: DragPayload = { source: 'palette', kind: 'custom' };
      lastDragPayloadRef.current = payload;
      setDragPayload(dt, payload, 'Custom token');
      dt.effectAllowed = 'copy';
      setBasicDragActive(true);
    };

  const handleExistingTokenDragStart = (event: React.DragEvent<HTMLDivElement>, tokenId: string) => {
      if (basicDisabled) {
        event.preventDefault();
        return;
      }
      if (editingTokenId) {
        finishCustomEdit(true);
      }
      const dt = event.dataTransfer;
      if (!dt) return;
      const payload: DragPayload = { source: 'existing', id: tokenId };
      lastDragPayloadRef.current = payload;
      setDragPayload(dt, payload, 'Column token');
      dt.effectAllowed = 'move';
      setBasicDragActive(true);
    };

  const handleExistingTokenDragEnd = () => {
    setBasicDragActive(false);
    setDropIndicator(null);
  };

  const handlePaletteDragEnd = () => {
    setBasicDragActive(false);
    setDropIndicator(null);
  };

  const handleTokenDragOver = (tokenId: string, event: React.DragEvent<HTMLDivElement>) => {
      if (basicDisabled) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const isBefore = event.clientX < rect.left + rect.width / 2;
      setDropIndicator({ tokenId, position: isBefore ? 'before' : 'after' });
    };

  const handleBuilderDragOver = (event: React.DragEvent<HTMLDivElement>) => {
      if (basicDisabled) return;
      event.preventDefault();
      const dt = event.dataTransfer;
      if (dt) {
        dt.dropEffect = dt.effectAllowed === 'move' ? 'move' : 'copy';
      }
      setBasicDragActive(true);
    };

  const handleBuilderDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dropZoneRef.current) return;
    const related = event.relatedTarget as Node | null;
    if (related && dropZoneRef.current.contains(related)) return;
    setBasicDragActive(false);
    setDropIndicator(null);
  };

  const handleBuilderDrop = (event: React.DragEvent<HTMLDivElement>) => {
      if (basicDisabled) return;
      event.preventDefault();
      setBasicDragActive(false);
      const payload = parseDragPayload(event);
      const indicator = dropIndicator;
      setDropIndicator(null);
      if (!payload) {
        lastDragPayloadRef.current = null;
        return;
      }
      let insertIndex = basicTokens.length;
      if (indicator) {
        const targetIdx = basicTokens.findIndex((token) => token.id === indicator.tokenId);
        if (targetIdx !== -1) {
          insertIndex = indicator.position === 'before' ? targetIdx : targetIdx + 1;
        }
      }

      if (payload.source === 'palette') {
        if (payload.kind === 'column') {
          addColumnToken(payload.column, insertIndex);
        } else if (payload.kind === 'custom') {
          addCustomToken(insertIndex);
        }
        lastDragPayloadRef.current = null;
        return;
      }

      if (payload.source === 'existing') {
        moveBasicToken(payload.id, insertIndex);
      }
      lastDragPayloadRef.current = null;
    };

  const handleApply = async () => {
    const currentExpression = latestExpressionRef.current.trim();
    if (!activeNodeId || currentExpression.length === 0) return;
    setApplyLoading(true);
    try {
      const payload = buildRequest();
      const response = await computeColumn(activeNodeId, payload);
      setLastAppliedExpression(response.expression);
      onAlert(response.message || `Added column ${response.column_name}`);
      void refreshNodeSchema(activeNodeId);
      commitExpression();
      refreshPreview();
    } catch {
      // Error shown via preview
    } finally {
      setApplyLoading(false);
    }
  };

  const handleExpressionChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setExpressionAndMarkDirty(next);
      setBasicTokens([]);
      setEditingTokenId(null);
      setDropIndicator(null);
      setBasicDragActive(false);
      setCustomDraft('');
    };

  const handleColumnNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = normalizeSmartCharacters(event.target.value);
      latestColumnNameRef.current = next;
      setColumnName(next);
    };

  const handleExpressionBlur = () => {
    setExpressionFocused(false);
    commitExpression();
  };

  const handleColumnBlur = () => {
    setColumnNameFocused(false);
    commitExpression();
  };

  const handleExpressionFocus = () => {
    setExpressionFocused(true);
  };

  const handleColumnFocus = () => {
    setColumnNameFocused(true);
  };

  const handleCustomDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomDraft(normalizeSmartCharacters(event.target.value));
  };

  const handleCustomInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finishCustomEdit(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finishCustomEdit(false);
      }
    };

  const basicExpressionPreview = tokensToExpression(basicTokens);
  const manualExpressionActive = basicTokens.length === 0 && trimmedExpression.length > 0;
  const currentExpressionMatchesApplied = lastAppliedExpression && lastAppliedExpression === trimmedExpression;

  const nodeColumnSelections = (limitedNodeId ? [{ nodeId: limitedNodeId, column: '' }] : []);

  const nodeColors = (limitedNodeId ? { [limitedNodeId]: DEFAULT_PALETTE[0] } : {});

  return {
    activeNodeId,
    hasSelection,
    nodeSelection: {
      effectiveNodes: effectiveSelectedNodes,
      nodeColumnSelections,
      nodeColors,
      defaultPalette: DEFAULT_PALETTE,
      originalCount: selectedNodes?.length ?? 0,
    },
    expression: {
      mode: expressionMode,
      setMode: setExpressionMode,
      expression,
      setExpression: setExpressionAndMarkDirty,
      columnName,
      setColumnName,
      focused: {
        expression: expressionFocused,
        columnName: columnNameFocused,
      },
      onExpressionFocus: handleExpressionFocus,
      onExpressionBlur: handleExpressionBlur,
      onColumnNameFocus: handleColumnFocus,
      onColumnNameBlur: handleColumnBlur,
      onChange: {
        expression: handleExpressionChange,
        columnName: handleColumnNameChange,
      },
    },
    basicBuilder: {
      tokens: basicTokens,
      disabled: basicDisabled,
      dragActive: basicDragActive,
      dropIndicator,
      editingTokenId,
      customDraft,
      expressionPreview: basicExpressionPreview,
      availableColumns,
      addColumnToken,
      addCustomToken,
      removeToken: removeBasicToken,
      moveToken: moveBasicToken,
      startEditingCustom: startEditingCustomToken,
      finishCustomEdit,
      clearBuilder: clearBasicBuilder,
      dropZoneRef,
      handlers: {
        customDraftChange: handleCustomDraftChange,
        customInputKeyDown: handleCustomInputKeyDown,
        columnDragStart: handleColumnDragStart,
        customDragStart: handleCustomDragStart,
        existingTokenDragStart: handleExistingTokenDragStart,
        existingTokenDragEnd: handleExistingTokenDragEnd,
        paletteDragEnd: handlePaletteDragEnd,
        tokenDragOver: handleTokenDragOver,
        builderDragOver: handleBuilderDragOver,
        builderDragLeave: handleBuilderDragLeave,
        builderDrop: handleBuilderDrop,
      },
    },
    preview: {
      data: previewData,
      columns: previewColumns,
      pagination: previewPagination,
      loading: previewLoading,
      error: previewError,
      ready: hasSelection,
      readyMessage: !hasSelection
        ? 'Select a data block to configure an expression.'
        : 'Showing original data. Configure an expression and exit the field to preview results.',
      page: previewPage,
      pageSize: previewPageSize,
      setPageSize: setPreviewPageSize,
      onPreviousPage: handlePreviewPrev,
      onNextPage: handlePreviewNext,
    },
    apply: {
      loading: applyLoading,
      canApply,
      lastAppliedExpression,
      currentMatchesApplied: !!currentExpressionMatchesApplied,
      handleApply,
    },
    manualExpressionActive,
    dropZoneRef,
  };
};
