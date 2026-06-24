import { useState } from 'react';

import type { AiAnnotationNodeResult, AiAnnotationResponse } from '@/api';

interface UseAiAnnotationResultControlsArgs {
  selectedColumn: string;
  defaultPageSize: number;
}

/**
 * Returns the first node result from an AI annotation response without mutating
 * the generated response object.
 * Used by: useAiAnnotationResultControls because the backend returns results
 * keyed by node id while the UI currently renders one selected node at a time.
 */
function readFirstNodeResult(response: AiAnnotationResponse | null): {
  nodeId: string | null;
  node: AiAnnotationNodeResult | null;
} {
  const data = response?.data;
  if (!data || typeof data !== 'object') {
    return { nodeId: null, node: null };
  }

  const firstNodeId = Object.keys(data)[0] ?? null;
  if (!firstNodeId) {
    return { nodeId: null, node: null };
  }

  const nodeData = data[firstNodeId] ?? null;
  if (!nodeData) {
    return { nodeId: firstNodeId, node: null };
  }

  return {
    nodeId: firstNodeId,
    node: {
      ...nodeData,
      metadata: response.metadata
        ? { ...(nodeData.metadata ?? {}), ...response.metadata }
        : nodeData.metadata,
    },
  };
}

/**
 * Owns AI annotation result-table state and display derivations.
 * Used by: AiAnnotatorFeature so API callbacks can hand over full responses
 * while the hook keeps result-node normalization, paging flags, metadata-column
 * selection, visible-column ordering, and clear reset in one place.
 * Flow: pick the first response node, merge response metadata into display
 * state, derive annotation/text/metadata columns, filter stale metadata
 * selections, and expose stable defaults when no result is loaded.
 */
export function useAiAnnotationResultControls({
  selectedColumn,
  defaultPageSize,
}: UseAiAnnotationResultControlsArgs) {
  const [resultNodeId, setResultNodeId] = useState<string | null>(null);
  const [resultNode, setResultNode] = useState<AiAnnotationNodeResult | null>(null);
  const [isPaging, setIsPaging] = useState(false);
  const [selectedMetadataColumns, setSelectedMetadataColumns] = useState<string[]>([]);

  /**
   * Applies a backend response to the currently rendered annotation result.
   * Called by: AiAnnotatorFeature lifecycle and page-load callbacks after the
   * backend returns a full AI annotation response.
   */
  const applyResponseResult = (response: AiAnnotationResponse | null) => {
    const { nodeId, node } = readFirstNodeResult(response);
    setResultNodeId(nodeId);
    setResultNode(node);
  };

  /**
   * Clears result-specific state after the shared analysis lifecycle clears a task.
   * Called by: AiAnnotatorFeature's clear callback so stale rows and metadata
   * selections cannot carry into the next run.
   */
  const resetAfterClear = () => {
    setResultNodeId(null);
    setResultNode(null);
    setSelectedMetadataColumns([]);
  };

  const resultRows = resultNode?.data ?? [];
  const resultColumns = resultNode?.columns ?? [];
  const annotationColumns = Array.isArray(resultNode?.metadata?.annotation_columns)
    ? (resultNode.metadata.annotation_columns as string[])
    : [];
  const inferredTextColumn =
    (selectedColumn && resultColumns.includes(selectedColumn) ? selectedColumn : null) ??
    resultColumns.find((column) => !annotationColumns.includes(column)) ??
    null;
  const availableMetadataColumns = resultColumns.filter(
    (column) => !annotationColumns.includes(column) && column !== inferredTextColumn,
  );

  const visibleMetadataColumns = selectedMetadataColumns.filter((column) =>
    availableMetadataColumns.includes(column),
  );
  const visibleColumns = (() => {
    const prioritized = [...annotationColumns, ...(inferredTextColumn ? [inferredTextColumn] : [])];
    const unique = Array.from(new Set([...prioritized.filter(Boolean), ...visibleMetadataColumns]));
    return unique.length > 0 ? unique : resultColumns;
  })();
  const pagination = resultNode?.pagination;
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.page_size ?? defaultPageSize;

  return {
    resultNodeId,
    resultNode,
    resultRows,
    resultColumns,
    annotationColumns,
    inferredTextColumn,
    availableMetadataColumns,
    selectedMetadataColumns: visibleMetadataColumns,
    setSelectedMetadataColumns,
    visibleColumns,
    pagination,
    page,
    pageSize,
    isPaging,
    setIsPaging,
    applyResponseResult,
    resetAfterClear,
  };
}
