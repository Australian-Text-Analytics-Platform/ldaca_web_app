import { useEffect, useRef, useState } from 'react';
import { insertItemAt, moveItemTo, removeItemAt } from './tokenIndexMath';

import type { WorkspaceNodeLike } from '@/features/views/common/nodeSelectionTypes';
import { takeMostRecent } from '@/features/workspace/common/utils/selectionUtils';
import {
  type FilterPreviewResponse,
  type PolarsExpressionRequest,
  type PolarsExpressionApplyResponse,
} from '@/api/generated/types.gen';
import { mapColumnsToInfo, type ColumnInfo } from '@/features/workspace/data-view/utils/columnTypes';
import { useNodePreviewWithRawFallback } from '../../hooks/useNodePreviewWithRawFallback';
import type { PreviewPagination, PreviewRow } from '../../types';

const SINGLE_NODE_PALETTE = ['#2563eb'];

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

/**
 * Normalizes smart quotes before expressions reach the backend parser. Builder
 * inputs and column-name fields use this so pasted prose does not break Polars
 * code unexpectedly.
 * Used by: local callers in preprocessing/useAggregateSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const normalizeSmartCharacters = (input: string): string =>
  input.replace(
    /[\u201C\u201D\u201E\u201F\u2018\u2019\u201A\u201B]/g,
    (char) => SMART_CHAR_MAP[char] ?? char,
  );

export type BasicToken =
  | { id: string; kind: 'column'; column: string; dtype: string; operations: string[] }
  | { id: string; kind: 'custom'; value: string };

export interface DropIndicator { tokenId: string; position: 'before' | 'after' }

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
  polarsExpressionPreview: (
    nodeId: string,
    request: PolarsExpressionRequest,
    page?: number,
    pageSize?: number,
  ) => Promise<FilterPreviewResponse>;
  polarsExpressionApply: (
    nodeId: string,
    request: PolarsExpressionRequest,
  ) => Promise<PolarsExpressionApplyResponse>;
  refreshNodeSchema: (nodeId: string) => Promise<unknown>;
}

export interface NodeSelectionConfig {
  effectiveNodes: WorkspaceNodeLike[];
  nodeColumnSelections: { nodeId: string; column: string }[];
  nodeColors: Record<string, string>;
  defaultPalette: string[];
  originalCount: number;
}

export interface ExpressionConfig {
  expression: string;
  columnName: string;
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
  handlers: {
    customDraftChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    customInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    columnDragStart: (
      event: React.DragEvent<HTMLButtonElement>,
      column: string,
      dtype: string,
    ) => void;
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
  disabledReason: string | undefined;
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
  dropZoneRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Creates stable token ids for the visual expression builder. Token lists use
 * these ids for React keys and drag/drop targeting.
 * Used by: local callers in preprocessing/useAggregateSubTab module because nearby helpers need the same normalization, formatting, or adapter rule without duplicating it.
 */
const createTokenId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `token-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Owns computed-column state for the Aggregate sub-tab. The component consumes
 * this hook for node selection, token-builder behavior, preview data, and apply
 * controls.
 * Used by: tokenIndexMath hook, AggregateSubTab module (rg call sites/imports) because those callers need a shared helper boundary for consistent feature state, formatting, or request payloads.
 * Flow: derive the active node and available columns, synchronize builder tokens with
 * expression text, handle drag/drop editing, run preview/apply requests, and return grouped
 * configs for the tab component.
 */
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

  const effectiveNodes = (() => {
    if (selectedNodes.length) {
      return takeMostRecent(selectedNodes, 1);
    }
    if (selectedNodeId) {
      const fallback = workspaceNodes.find((node, idx) => {
        // Empty-string ids fall through to the next candidate, so keep `||`.
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        const identifier = node.id || node.node_id || `node-${String(idx)}`;
        return identifier === selectedNodeId;
      });
      if (fallback) {
        return [fallback];
      }
    }
    return [] as WorkspaceNodeLike[];
  })();

  const limitedNodeId = (() => {
    const first = effectiveNodes[0];
    if (!first) return null;
    // Empty-string ids fall through to the next candidate, so keep `||`.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    return first.id || first.node_id || null;
  })();

  const [expression, setExpression] = useState('');
  const [columnName, setColumnName] = useState('new_column');
  const [applyLoading, setApplyLoading] = useState(false);
  const [lastAppliedExpression, setLastAppliedExpression] = useState<string | null>(null);
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
  const latestColumnNameRef = useRef('new_column');
  const lastDragPayloadRef = useRef<DragPayload | null>(null);

  const workspaceNodeMap = (() => {
    const map = new Map<string, WorkspaceNodeLike>();
    workspaceNodes.forEach((node, idx) => {
      // Empty-string ids fall through to the next candidate, so keep `||`.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      const id = node.id || node.node_id || `node-${String(idx)}`;
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
  const trimmedExpression = expression.trim();
  const basicDisabled = !hasSelection || isLoading.operations;

  const availableColumns: ColumnInfo[] = (() => {
    if (!effectiveSelectedNodes.length) return [];
    const [node] = effectiveSelectedNodes;
    return mapColumnsToInfo(node).filter(
      (info) => typeof info.name === 'string' && info.name.length > 0,
    );
  })();

  /**
   * Escapes custom literal text before embedding it into generated Polars code.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const escapeLiteralValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  /**
   * Converts one visual builder token into a Polars expression fragment.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: escape column names, append selected operations, and serialize literal custom
   * tokens as strings or numeric values.
   */
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

  /**
   * Joins all builder tokens into the expression shown in the code preview.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const tokensToExpression = (tokens: BasicToken[]) => tokens.map(tokenToPolars).join(' + ');

  /**
   * Updates the text expression and its latest ref together so debounced commit
   * and apply logic read the same normalized value.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setExpressionAndMarkDirty = (nextExpression: string) => {
    const normalizedExpression = normalizeSmartCharacters(nextExpression);
    latestExpressionRef.current = normalizedExpression;
    setExpression(normalizedExpression);
  };

  /**
   * Applies token-list edits and mirrors them into the generated expression.
   * All token add/remove/move/operation handlers route through this helper.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: run the token updater, rebuild the expression preview, preserve no-op token
   * references, and mark expression state dirty when needed.
   */
  const applyBasicTokenUpdate = (updater: (prev: BasicToken[]) => BasicToken[]) => {
    setBasicTokens((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      const sameOrder =
        next.length === prev.length && next.every((token, idx) => token === prev[idx]);
      const nextExpression = tokensToExpression(next);
      if (sameOrder && nextExpression === trimmedExpression) {
        return prev;
      }
      setExpressionAndMarkDirty(nextExpression);
      return sameOrder ? prev : next;
    });
  };

  /**
   * Builds the backend request from the latest expression/column refs. Preview
   * and apply paths use the same alias-wrapping behavior.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Commits the current expression/name into the debounced preview payload.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Debounces expression commits so typing/dragging does not fire preview calls
   * for every intermediate token state.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  const operationPayload: PolarsExpressionRequest | null = (() => {
    if (committedExpression.length === 0) return null;
    let code = committedExpression;
    if (committedColumnName.length > 0) {
      const safeName = committedColumnName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      code = `(${code}).alias("${safeName}")`;
    }
    return {
      context: 'with_columns',
      expressions: [{ code }],
    };
  })();

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
  } = useNodePreviewWithRawFallback<PolarsExpressionRequest>({
    nodeId: activeNodeId,
    operationPayload,
    operationFetch: polarsExpressionPreview,
    signaturePrefix: 'aggregate',
    enabled: hasSelection,
    debounceMs: 100,
  });

  const canApply =
    hasSelection &&
    trimmedExpression.length > 0 &&
    !applyLoading &&
    !isLoading.operations &&
    !previewError;

  /**
   * Adds a selected source column to the builder, optionally at a drag/drop
   * insertion index.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const addColumnToken = (column: string, dtype: string, index?: number) => {
    if (basicDisabled || !column) return;
    applyBasicTokenUpdate((prev) =>
      insertItemAt(prev, index, {
        id: createTokenId(),
        kind: 'column',
        column,
        dtype,
        operations: [],
      }),
    );
    scheduleCommit();
  };

  /**
   * Adds an editable literal token and puts it into edit mode for immediate
   * typing.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const addCustomToken = (index?: number) => {
    if (basicDisabled) return;
    const tokenId = createTokenId();
    applyBasicTokenUpdate((prev) =>
      insertItemAt(prev, index, { id: tokenId, kind: 'custom', value: '' }),
    );
    setEditingTokenId(tokenId);
    setCustomDraft('');
    customOriginalRef.current = '';
  };

  /**
   * Removes a builder token by id. Token chip delete buttons call this handler.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const removeBasicToken = (tokenId: string) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) => {
      const idx = prev.findIndex((token) => token.id === tokenId);
      if (idx === -1) return prev;
      return removeItemAt(prev, idx);
    });
    scheduleCommit();
  };

  /**
   * Reorders an existing token after drag/drop. The visual builder calls this
   * with the calculated insertion index.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: resolve the token index, move it through shared index math, suppress no-op
   * reference churn, and schedule a preview commit.
   */
  const moveBasicToken = (tokenId: string, index: number) => {
    if (basicDisabled) return;
    applyBasicTokenUpdate((prev) => {
      const currentIndex = prev.findIndex((token) => token.id === tokenId);
      if (currentIndex === -1) return prev;
      const moved = moveItemTo(prev, currentIndex, index);
      // moveItemTo returns a fresh array even on no-op moves; preserve the
      // hook's prev-reference contract so consumers don't see a spurious
      // re-render.
      const isNoOp = moved.length === prev.length && moved.every((token, i) => token === prev[i]);
      return isNoOp ? prev : moved;
    });
    scheduleCommit();
  };

  /**
   * Appends a backend-advertised operation to a column token.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Removes one operation from a column token. Operation chips use this to undo
   * method additions.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Opens a custom token for editing while preserving the original value for
   * Escape/cancel.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const startEditingCustomToken = (tokenId: string) => {
    if (basicDisabled) return;
    const target = basicTokens.find(
      (token): token is Extract<BasicToken, { kind: 'custom' }> =>
        token.id === tokenId && token.kind === 'custom',
    );
    if (!target) return;
    const normalizedValue = normalizeSmartCharacters(target.value);
    setEditingTokenId(tokenId);
    setCustomDraft(normalizedValue);
    customOriginalRef.current = normalizedValue;
  };

  /**
   * Commits or cancels the custom-token draft. Keyboard and blur handlers use
   * this shared path.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: apply committed text when requested, restore the original draft on cancel,
   * schedule preview updates, and clear edit state.
   */
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

  /**
   * Clears all builder tokens and the generated expression for the Clear button.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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

  /**
   * Reads a drag payload from browser drag metadata, with a ref fallback for
   * environments that strip custom MIME data during dragover/drop.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: try custom, JSON, and plain-text drag payloads, then fall back to the last
   * in-memory payload for WebView compatibility.
   */
  const parseDragPayload = (event: React.DragEvent): DragPayload | null => {
    /**
     * Decodes one serialized drag payload candidate.
     * Called by: parseDragPayload internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
     */
    const decode = (raw: string | null | undefined): DragPayload | null => {
      if (!raw) return null;
      try {
        const candidate = JSON.parse(raw) as DragPayload;
        // candidate is untrusted JSON.parse output, so validate it is an object.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        return candidate && typeof candidate === 'object' ? candidate : null;
      } catch {
        return null;
      }
    };

    const dt = event.dataTransfer;
    // React types dataTransfer as non-null, but it can be null at runtime (DOM).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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

  /**
   * Writes drag payloads in several MIME slots so browser/WebView drag behavior
   * stays compatible across the desktop and web builds.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const setDragPayload = (
    dataTransfer: DataTransfer,
    payload: DragPayload,
    plainText: string,
  ): void => {
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

  /**
   * Starts dragging a source-column palette token into the builder.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Flow: block disabled drags, build a column payload, cache it for fallback reads, write transfer data, and mark copy drag active.
   */
  const handleColumnDragStart = (
    event: React.DragEvent<HTMLButtonElement>,
    column: string,
    dtype: string,
  ) => {
    if (basicDisabled) {
      event.preventDefault();
      return;
    }
    const dt = event.dataTransfer;
    // React types dataTransfer as non-null, but it can be null at runtime (DOM).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!dt) return;
    const payload: DragPayload = { source: 'palette', kind: 'column', column, dtype };
    lastDragPayloadRef.current = payload;
    setDragPayload(dt, payload, column);
    dt.effectAllowed = 'copy';
    setBasicDragActive(true);
  };

  /**
   * Starts dragging a blank custom-literal palette token into the builder.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleCustomDragStart = (event: React.DragEvent<HTMLButtonElement>) => {
    if (basicDisabled) {
      event.preventDefault();
      return;
    }
    const dt = event.dataTransfer;
    // React types dataTransfer as non-null, but it can be null at runtime (DOM).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!dt) return;
    const payload: DragPayload = { source: 'palette', kind: 'custom' };
    lastDragPayloadRef.current = payload;
    setDragPayload(dt, payload, 'Custom token');
    dt.effectAllowed = 'copy';
    setBasicDragActive(true);
  };

  /**
   * Starts moving an existing token, committing any active custom edit first so
   * the drag payload reflects stable token state.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Flow: prevent disabled drags, finish pending custom edits, create an existing-token payload, write transfer data, and mark move drag active.
   */
  const handleExistingTokenDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    tokenId: string,
  ) => {
    if (basicDisabled) {
      event.preventDefault();
      return;
    }
    if (editingTokenId) {
      finishCustomEdit(true);
    }
    const dt = event.dataTransfer;
    // React types dataTransfer as non-null, but it can be null at runtime (DOM).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!dt) return;
    const payload: DragPayload = { source: 'existing', id: tokenId };
    lastDragPayloadRef.current = payload;
    setDragPayload(dt, payload, 'Column token');
    dt.effectAllowed = 'move';
    setBasicDragActive(true);
  };

  /**
   * Clears builder drag state after dragging an existing token ends.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleExistingTokenDragEnd = () => {
    setBasicDragActive(false);
    setDropIndicator(null);
  };

  /**
   * Clears builder drag state after dragging a palette token ends.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handlePaletteDragEnd = () => {
    setBasicDragActive(false);
    setDropIndicator(null);
  };

  /**
   * Updates the before/after insertion indicator when dragging over a token.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleTokenDragOver = (tokenId: string, event: React.DragEvent<HTMLDivElement>) => {
    if (basicDisabled) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const isBefore = event.clientX < rect.left + rect.width / 2;
    setDropIndicator({ tokenId, position: isBefore ? 'before' : 'after' });
  };

  /**
   * Keeps the builder drop zone active and sets the browser copy/move cue while
   * a valid token is dragged over it.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleBuilderDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (basicDisabled) return;
    event.preventDefault();
    const dt = event.dataTransfer;
    // React types dataTransfer as non-null, but it can be null at runtime (DOM).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (dt) {
      dt.dropEffect = dt.effectAllowed === 'move' ? 'move' : 'copy';
    }
    setBasicDragActive(true);
  };

  /**
   * Clears drop-zone state only when the drag leaves the entire builder surface.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleBuilderDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!dropZoneRef.current) return;
    const related = event.relatedTarget as Node | null;
    if (related && dropZoneRef.current.contains(related)) return;
    setBasicDragActive(false);
    setDropIndicator(null);
  };

  /**
   * Inserts, creates, or reorders builder tokens after a drop. The visual drop
   * zone and token rows share this handler.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Steps: clear drag state, resolve the insertion index, distinguish palette from existing
   * tokens, then delegate to add/move helpers.
   */
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
        // payload comes from untrusted JSON.parse; keep the explicit kind check.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      } else if (payload.kind === 'custom') {
        addCustomToken(insertIndex);
      }
      lastDragPayloadRef.current = null;
      return;
    }

    // payload comes from untrusted JSON.parse; keep the explicit source check.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (payload.source === 'existing') {
      moveBasicToken(payload.id, insertIndex);
    }
    lastDragPayloadRef.current = null;
  };

  /**
   * Applies the current expression to the active node, refreshes schema, and
   * refreshes preview so the sub-tab reflects the created column.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   * Flow: guard missing node or expression, build the request, apply it, announce the created node, refresh schema/preview, and clear loading.
   */
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

  /**
   * Updates the output column name while keeping the latest ref in sync for
   * delayed preview commits.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleColumnNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = normalizeSmartCharacters(event.target.value);
    latestColumnNameRef.current = next;
    setColumnName(next);
  };

  /**
   * Forces the preview payload to commit when the column-name field blurs.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleColumnBlur = () => {
    commitExpression();
  };

  /**
   * Normalizes smart characters while editing a custom literal token.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
  const handleCustomDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomDraft(normalizeSmartCharacters(event.target.value));
  };

  /**
   * Handles Enter/Escape for custom-token editing so keyboard interactions
   * share the same commit/cancel path as pointer interactions.
   * Called by: useAggregateSubTab internal event, effect, or helper flow because the named handler keeps state updates, backend calls, and cleanup in one predictable path.
   */
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
  const currentExpressionMatchesApplied =
    lastAppliedExpression && lastAppliedExpression === trimmedExpression;

  const nodeColumnSelections = limitedNodeId ? [{ nodeId: limitedNodeId, column: '' }] : [];

  const nodeColors = (limitedNodeId
    ? // SINGLE_NODE_PALETTE is a non-empty module constant, so index 0 exists.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      { [limitedNodeId]: SINGLE_NODE_PALETTE[0]! }
    : {}) as Record<string, string>;

  return {
    activeNodeId,
    hasSelection,
    nodeSelection: {
      effectiveNodes: effectiveSelectedNodes,
      nodeColumnSelections,
      nodeColors,
      defaultPalette: SINGLE_NODE_PALETTE,
      originalCount: selectedNodes.length,
    },
    expression: {
      expression,
      columnName,
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
      disabledReason: (() => {
        if (applyLoading || isLoading.operations) return undefined;
        if (!hasSelection) return 'Select a data block first';
        if (!trimmedExpression.length) return 'Build an expression first';
        if (previewError)
          return 'Fix the expression error shown in Preview before adding to the data block';
        return undefined;
      })(),
      lastAppliedExpression,
      currentMatchesApplied: !!currentExpressionMatchesApplied,
      handleApply,
    },
    dropZoneRef,
  };
};
