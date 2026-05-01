import { useEffect, useRef, useState } from 'react';

import type { WorkspaceNodeLike } from '../../../../components/NodeSelectionPanel';
import { takeMostRecent } from '../../../../utils/selectionUtils';
import {
  nodesApi,
  type FilterPreviewResponse,
  type PolarsExpressionRequest,
  type PolarsExpressionApplyResponse,
} from '../../../../api/nodes';
import { useAuth } from '../../../../hooks/useAuth';
import { mapColumnsToInfo, type ColumnInfo } from '../../../../utils/columnTypes';
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
  | { id: string; kind: 'column'; column: string; dtype: string; operations: string[] }
  | { id: string; kind: 'custom'; value: string };

export type DropIndicator = { tokenId: string; position: 'before' | 'after' };

export type DragPayload =
  | { source: 'palette'; kind: 'column'; column: string; dtype: string }
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
  polarsExpressionPreview: (nodeId: string, request: PolarsExpressionRequest, page?: number, pageSize?: number) => Promise<FilterPreviewResponse>;
  polarsExpressionApply: (nodeId: string, request: PolarsExpressionRequest) => Promise<PolarsExpressionApplyResponse>;
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
  availableColumns: ColumnInfo[];
  addColumnToken: (column: string, dtype: string, index?: number) => void;
  addCustomToken: (index?: number) => void;
  removeToken: (tokenId: string) => void;
  moveToken: (tokenId: string, index: number) => void;
  addOperation: (tokenId: string, operation: string) => void;
  removeOperation: (tokenId: string, index: number) => void;
  startEditingCustom: (tokenId: string) => void;
  finishCustomEdit: (commit: boolean) => void;
  clearBuilder: () => void;
  dropZoneRef: React.RefObject<HTMLDivElement | null>;
  handlers: {
    customDraftChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    customInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    columnDragStart: (event: React.DragEvent<HTMLButtonElement>, column: string, dtype: string) => void;
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
  onPageChange: (page: number) => void;
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
    polarsExpressionPreview,
    polarsExpressionApply,
    refreshNodeSchema,
  } = props;
  const { getAuthHeaders } = useAuth();

  const effectiveNodes = (() => {
    if (selectedNodes?.length) {
      return takeMostRecent(selectedNodes, 1);
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
    const first = effectiveNodes[0]!;
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

  const availableColumns: ColumnInfo[] = (() => {
    if (!effectiveSelectedNodes.length) return [];
    const [node] = effectiveSelectedNodes;
    return mapColumnsToInfo(node).filter(
      (info) => typeof info.name === 'string' && info.name.length > 0,
    );
  })();

  const escapeLiteralValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const tokenToPolars = (token: BasicToken): string => {
    if (token.kind === 'column') {
      const safe = token.column.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      let expr = `pl.col("${safe}")`;
      for (const op of token.operations) {
        expr += `.${op}()`;
      }
      return expr;
    }
    // custom token → pl.lit(...)
    const raw = token.value;
    if (!raw.length) return 'pl.lit("")';
    const trimmed = raw.trim();
    // If it looks like an already-quoted string, respect it
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return `pl.lit(${trimmed})`;
    }
    // Numeric literals
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return `pl.lit(${trimmed})`;
    }
    return `pl.lit("${escapeLiteralValue(raw)}")`;
  };

  const tokensToExpression = (tokens: BasicToken[]) =>
      tokens.map(tokenToPolars).join(' + ');

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

  const buildRequest = (): PolarsExpressionRequest => {
    const expressionValue = latestExpressionRef.current.trim();
    const columnValue = latestColumnNameRef.current.trim();
    let code = expressionValue;
    if (columnValue.length > 0) {
      const safeName = columnValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      code = `(${code}).alias("${safeName}")`;
    }
    return {
      context: 'with_columns',
      expressions: [{ code }],
    };
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
    payload: PolarsExpressionRequest | null;
  }

  const aggregatePreviewRequest: AggregatePreviewRequest | null = (() => {
    if (!hasSelection || !activeNodeId) return null;
    if (committedExpression.length === 0) return { nodeId: activeNodeId, payload: null };
    let code = committedExpression;
    if (committedColumnName.length > 0) {
      const safeName = committedColumnName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      code = `(${code}).alias("${safeName}")`;
    }
    const payload: PolarsExpressionRequest = {
      context: 'with_columns',
      expressions: [{ code }],
    };
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
      const response = await polarsExpressionPreview(request.nodeId, request.payload, page, pageSize);
      return {
        data: Array.isArray(response?.data) ? (response.data as PreviewRow[]) : [],
        columns: Array.isArray(response?.columns) ? response.columns : [],
        pagination: (response?.pagination as PreviewPagination) ?? null,
      };
    }
    const response = await nodesApi.data(request.nodeId, { page, pageSize }, getAuthHeaders());
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

  const clampIndex = (value: number, max: number) => {
    if (Number.isNaN(value)) return max;
    if (value < 0) return 0;
    if (value > max) return max;
    return value;
  };

  const addColumnToken = (column: string, dtype: string, index?: number) => {
      if (basicDisabled || !column) return;
      applyBasicTokenUpdate((prev) => {
        const next = [...prev];
        const insertIndex = clampIndex(index ?? next.length, next.length);
        next.splice(insertIndex, 0, { id: createTokenId(), kind: 'column', column, dtype, operations: [] });
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
        const [item] = next.splice(currentIndex, 1) as [BasicToken];
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

  const addOperation = (tokenId: string, operation: string) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) =>
      prev.map((token) => {
        if (token.id === tokenId && token.kind === 'column') {
          return { ...token, operations: [...token.operations, operation] };
        }
        return token;
      }),
    );
    scheduleCommit();
  };

  const removeOperation = (tokenId: string, index: number) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) =>
      prev.map((token) => {
        if (token.id === tokenId && token.kind === 'column') {
          const next = [...token.operations];
          next.splice(index, 1);
          return { ...token, operations: next };
        }
        return token;
      }),
    );
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

  const handleColumnDragStart = (event: React.DragEvent<HTMLButtonElement>, column: string, dtype: string) => {
      if (basicDisabled) {
        event.preventDefault();
        return;
      }
      const dt = event.dataTransfer;
      if (!dt) return;
      const payload: DragPayload = { source: 'palette', kind: 'column', column, dtype };
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
          addColumnToken(payload.column, payload.dtype, insertIndex);
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
      const response = await polarsExpressionApply(activeNodeId, payload);
      setLastAppliedExpression(currentExpression);
      onAlert(`Applied expression to ${response.node_name}`);
      void refreshNodeSchema(activeNodeId);
      commitExpression();
      refreshPreview();
    } catch {
      // Error shown via preview
    } finally {
      setApplyLoading(false);
    }
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

  const nodeColors = (limitedNodeId ? { [limitedNodeId]: DEFAULT_PALETTE[0]! } : {}) as Record<string, string>;

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
      addOperation,
      removeOperation,
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
      onPageChange: setPreviewPage,
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
