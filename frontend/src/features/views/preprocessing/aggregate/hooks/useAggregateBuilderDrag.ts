import { useRef, type Dispatch, type DragEvent, type RefObject } from 'react';

import type { AggregateBuilderUiAction, AggregateDropIndicator } from './aggregateBuilderUiState';
import type { AggregateBuilderToken } from './aggregateExpressionModel';

export type AggregateBuilderDragPayload =
  | { source: 'palette'; kind: 'column'; column: string; dtype: string }
  | { source: 'palette'; kind: 'custom' }
  | { source: 'existing'; id: string };

const AGGREGATE_TOKEN_MIME = 'application/x-ldaca-builder-token';
const DRAG_PAYLOAD_TYPES = [AGGREGATE_TOKEN_MIME, 'application/json', 'text/plain'] as const;

interface UseAggregateBuilderDragHandlersParams {
  disabled: boolean;
  tokens: AggregateBuilderToken[];
  dropIndicator: AggregateDropIndicator | null;
  dropZoneRef: RefObject<HTMLDivElement | null>;
  editingTokenId: string | null;
  finishCustomEdit: (commit: boolean) => void;
  addColumnToken: (column: string, dtype: string, index?: number) => void;
  addCustomToken: (index?: number) => void;
  moveToken: (tokenId: string, index: number) => void;
  dispatchBuilderUi: Dispatch<AggregateBuilderUiAction>;
}

export interface AggregateBuilderDragHandlers {
  columnDragStart: (event: DragEvent<HTMLButtonElement>, column: string, dtype: string) => void;
  customDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  existingTokenDragStart: (event: DragEvent<HTMLDivElement>, tokenId: string) => void;
  existingTokenDragEnd: () => void;
  paletteDragEnd: () => void;
  tokenDragOver: (tokenId: string, event: DragEvent<HTMLDivElement>) => void;
  builderDragOver: (event: DragEvent<HTMLDivElement>) => void;
  builderDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  builderDrop: (event: DragEvent<HTMLDivElement>) => void;
}

/**
 * Validates a parsed Aggregate builder drag payload. Drag metadata can come
 * from browser APIs or test doubles, so this keeps malformed JSON from being
 * treated as a token operation.
 * Used by: readAggregateDragPayload and its tests because both need the same
 * palette/existing-token shape rules.
 */
const isAggregateBuilderDragPayload = (
  candidate: unknown,
): candidate is AggregateBuilderDragPayload => {
  if (!candidate || typeof candidate !== 'object') return false;
  const record = candidate as Record<string, unknown>;

  if (record.source === 'existing') {
    return typeof record.id === 'string';
  }

  if (record.source !== 'palette') return false;
  if (record.kind === 'custom') return true;
  return (
    record.kind === 'column' &&
    typeof record.column === 'string' &&
    typeof record.dtype === 'string'
  );
};

/**
 * Decodes one serialized Aggregate builder drag payload candidate.
 * Used by: readAggregateDragPayload, which checks the browser's supported drag
 * data slots in priority order before falling back to the in-memory payload.
 */
const decodeAggregateDragPayload = (
  raw: string | null | undefined,
): AggregateBuilderDragPayload | null => {
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as unknown;
    return isAggregateBuilderDragPayload(candidate) ? candidate : null;
  } catch {
    return null;
  }
};

/**
 * Reads Aggregate builder drag metadata from DataTransfer, then falls back to
 * the cached in-memory payload for WebView environments that strip custom MIME
 * entries during dragover/drop.
 * Used by: useAggregateBuilderDragHandlers during builder drops and by tests
 * that exercise MIME priority and fallback behavior without rendering React.
 */
export const readAggregateDragPayload = (
  dataTransfer: Pick<DataTransfer, 'getData'> | null | undefined,
  fallback: AggregateBuilderDragPayload | null,
): AggregateBuilderDragPayload | null => {
  if (dataTransfer) {
    for (const type of DRAG_PAYLOAD_TYPES) {
      const decoded = decodeAggregateDragPayload(dataTransfer.getData(type));
      if (decoded) return decoded;
    }
  }
  return fallback;
};

/**
 * Writes Aggregate builder drag metadata to the custom, JSON, and plain-text
 * slots. The first two preserve structured payloads, while plain text keeps
 * older browser/WebView drag surfaces interoperable.
 * Used by: palette and existing-token drag-start handlers in
 * useAggregateBuilderDragHandlers.
 */
export const writeAggregateDragPayload = (
  dataTransfer: Pick<DataTransfer, 'setData'>,
  payload: AggregateBuilderDragPayload,
  plainText: string,
): void => {
  const encoded = JSON.stringify(payload);
  const attempts: (readonly [string, string])[] = [
    [AGGREGATE_TOKEN_MIME, encoded],
    ['application/json', encoded],
    ['text/plain', plainText],
  ];

  for (const [type, value] of attempts) {
    try {
      dataTransfer.setData(type, value);
    } catch {
      /* Some WebViews reject custom or duplicate drag data types. */
    }
  }
};

/**
 * Converts the current visual drop indicator into an insertion slot for the
 * token list. When no valid indicator exists, drops append to the end.
 * Used by: useAggregateBuilderDragHandlers and aggregateBuilderDrag tests so
 * drag/drop placement rules stay independent of browser events.
 */
export const getAggregateDropInsertIndex = (
  tokens: AggregateBuilderToken[],
  indicator: AggregateDropIndicator | null,
): number => {
  if (!indicator) return tokens.length;
  const targetIndex = tokens.findIndex((token) => token.id === indicator.tokenId);
  if (targetIndex === -1) return tokens.length;
  return indicator.position === 'before' ? targetIndex : targetIndex + 1;
};

/**
 * Owns browser drag/drop behavior for the Aggregate visual expression builder.
 * `useAggregateSubTab` keeps expression, preview, and apply state, while this
 * hook handles DataTransfer payloads, drop-zone state, and token insertion
 * routing.
 * Used by: useAggregateSubTab, which exposes these handlers through its
 * basicBuilder contract for AggregateSubTab rendering.
 * Flow: cache payloads on drag start, update the shared builder UI reducer
 * during hover/leave/end, read the payload on drop, resolve the insertion
 * index, then delegate token add/move mutations back to useAggregateSubTab.
 */
export const useAggregateBuilderDragHandlers = (
  params: UseAggregateBuilderDragHandlersParams,
): AggregateBuilderDragHandlers => {
  const {
    disabled,
    tokens,
    dropIndicator,
    dropZoneRef,
    editingTokenId,
    finishCustomEdit,
    addColumnToken,
    addCustomToken,
    moveToken,
    dispatchBuilderUi,
  } = params;

  const lastDragPayloadRef = useRef<AggregateBuilderDragPayload | null>(null);

  const handleColumnDragStart = (
    event: DragEvent<HTMLButtonElement>,
    column: string,
    dtype: string,
  ) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const payload: AggregateBuilderDragPayload = {
      source: 'palette',
      kind: 'column',
      column,
      dtype,
    };
    lastDragPayloadRef.current = payload;
    writeAggregateDragPayload(event.dataTransfer, payload, column);
    event.dataTransfer.effectAllowed = 'copy';
    dispatchBuilderUi({ type: 'setDragActive', active: true });
  };

  const handleCustomDragStart = (event: DragEvent<HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    const payload: AggregateBuilderDragPayload = { source: 'palette', kind: 'custom' };
    lastDragPayloadRef.current = payload;
    writeAggregateDragPayload(event.dataTransfer, payload, 'Custom token');
    event.dataTransfer.effectAllowed = 'copy';
    dispatchBuilderUi({ type: 'setDragActive', active: true });
  };

  const handleExistingTokenDragStart = (event: DragEvent<HTMLDivElement>, tokenId: string) => {
    if (disabled) {
      event.preventDefault();
      return;
    }
    if (editingTokenId) {
      finishCustomEdit(true);
    }
    const payload: AggregateBuilderDragPayload = { source: 'existing', id: tokenId };
    lastDragPayloadRef.current = payload;
    writeAggregateDragPayload(event.dataTransfer, payload, 'Column token');
    event.dataTransfer.effectAllowed = 'move';
    dispatchBuilderUi({ type: 'setDragActive', active: true });
  };

  const clearDragState = () => {
    dispatchBuilderUi({ type: 'clearDragState' });
  };

  const handleTokenDragOver = (tokenId: string, event: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const isBefore = event.clientX < rect.left + rect.width / 2;
    dispatchBuilderUi({
      type: 'setDropIndicator',
      indicator: { tokenId, position: isBefore ? 'before' : 'after' },
    });
  };

  const handleBuilderDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    dispatchBuilderUi({ type: 'setDragActive', active: true });
  };

  const handleBuilderDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!dropZoneRef.current) return;
    const related = event.relatedTarget as Node | null;
    if (related && dropZoneRef.current.contains(related)) return;
    dispatchBuilderUi({ type: 'clearDragState' });
  };

  const handleBuilderDrop = (event: DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    const payload = readAggregateDragPayload(event.dataTransfer, lastDragPayloadRef.current);
    const insertIndex = getAggregateDropInsertIndex(tokens, dropIndicator);
    dispatchBuilderUi({ type: 'clearDragState' });
    lastDragPayloadRef.current = null;
    if (!payload) return;

    if (payload.source === 'palette') {
      if (payload.kind === 'column') {
        addColumnToken(payload.column, payload.dtype, insertIndex);
      } else {
        addCustomToken(insertIndex);
      }
      return;
    }

    moveToken(payload.id, insertIndex);
  };

  return {
    columnDragStart: handleColumnDragStart,
    customDragStart: handleCustomDragStart,
    existingTokenDragStart: handleExistingTokenDragStart,
    existingTokenDragEnd: clearDragState,
    paletteDragEnd: clearDragState,
    tokenDragOver: handleTokenDragOver,
    builderDragOver: handleBuilderDragOver,
    builderDragLeave: handleBuilderDragLeave,
    builderDrop: handleBuilderDrop,
  };
};
