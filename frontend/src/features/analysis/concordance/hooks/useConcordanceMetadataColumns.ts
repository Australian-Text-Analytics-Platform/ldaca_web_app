import { useMemo } from 'react';
import type {
  ConcordanceAnalysisResponse,
  ConcordanceNodeResult as ConcordanceResultEntry,
} from '@/api/generated/types.gen';
import type { NodeColumnSelection } from '../../common';
import type { WorkspaceNodeLike } from '../../common/nodeSelectionTypes';

type Section = { columns: string[]; color?: string; disabled?: boolean };

export type ConcordanceMetadataColumnSet = {
  availableMetadataColumns: string[];
  metadataColumnSections: Section[];
  metadataDisabledReason: string | undefined;
};

type GetColumnInfo = (node: WorkspaceNodeLike, idx: number) => Array<{ name?: string }>;
type ResolveNodeIdForKey = (nodeKey: string) => string | null;

type Params = {
  results: ConcordanceAnalysisResponse | null;
  panelSelectedNodes: WorkspaceNodeLike[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  getColumnInfos: GetColumnInfo;
  viewMode: 'separated' | 'combined';
  nodeColors: Record<string, string>;
  resolveNodeIdForKey: ResolveNodeIdForKey;
};

/**
 * Compute the list of metadata columns + per-section visibility for the
 * Concordance feature. In Combined view, columns exclusive to one source can't
 * be rendered in the merged table — they'd be NULL for rows from the other
 * block — so we surface them as visible-but-disabled, and disable the whole
 * "Show metadata" UI when there are no columns common to all blocks.
 */
export function useConcordanceMetadataColumns({
  results,
  panelSelectedNodes,
  effectiveNodeColumnSelections,
  getColumnInfos,
  viewMode,
  nodeColors,
  resolveNodeIdForKey,
}: Params): ConcordanceMetadataColumnSet {
  // panelSelectedNodes / nodeColors / effectiveNodeColumnSelections may be
  // recreated each render (the parent Provider doesn't yet memoize all of
  // them); useMemo's deps include them so we still get fresh output, but we
  // also stabilize the IIFE body which used to re-run unconditionally.
  return useMemo<ConcordanceMetadataColumnSet>(() => {
    const resultEntries = results?.data ?? {};
    const perBlock: { nodeKey: string; columns: string[] }[] = [];
    for (const [nodeKey, entry] of Object.entries(resultEntries)) {
      if (nodeKey === '__COMBINED__') continue;
      const nodeEntry = entry as ConcordanceResultEntry;
      const cols = nodeEntry.metadata.metadata_columns.filter(
        (c) => c && c !== '__source_node',
      );
      perBlock.push({ nodeKey, columns: cols });
    }
    if (perBlock.length === 0 && panelSelectedNodes.length > 0) {
      panelSelectedNodes.forEach((node, idx) => {
        const rawId = (node as { id?: string }).id;
        const rawName = (node as { name?: string }).name;
        const nodeKey = rawName || rawId || `node-${idx}`;
        const sel = rawId
          ? effectiveNodeColumnSelections.find((s) => s.nodeId === rawId)
          : undefined;
        const textColumn = sel?.column;
        const cols = getColumnInfos(node, idx)
          .map((info) => info.name)
          .filter((name): name is string =>
            !!name && name !== textColumn && name !== '__source_node',
          );
        if (cols.length > 0) perBlock.push({ nodeKey, columns: cols });
      });
    }
    const allColumns = Array.from(
      new Set(perBlock.flatMap((b) => b.columns)),
    );
    const sections: Section[] = [];
    let disabledReason: string | undefined;
    const isCombinedView = viewMode === 'combined';
    if (perBlock.length <= 1) {
      if (allColumns.length > 0) sections.push({ columns: allColumns });
    } else {
      const common = perBlock[0]!.columns.filter((c) =>
        perBlock.every((b) => b.columns.includes(c)),
      );
      if (isCombinedView && common.length === 0 && perBlock.some((b) => b.columns.length > 0)) {
        disabledReason = 'The selected data blocks share no metadata columns; nothing to display in Combined view.';
      }
      if (common.length > 0) sections.push({ columns: common });
      for (const block of perBlock) {
        const exclusive = block.columns.filter((c) => !common.includes(c));
        if (exclusive.length === 0) continue;
        const nodeId = resolveNodeIdForKey(block.nodeKey);
        const color = nodeId ? nodeColors[nodeId] : undefined;
        sections.push({
          columns: exclusive,
          color,
          disabled: isCombinedView,
        });
      }
    }
    return {
      availableMetadataColumns: allColumns,
      metadataColumnSections: sections,
      metadataDisabledReason: disabledReason,
    };
  }, [
    results,
    panelSelectedNodes,
    effectiveNodeColumnSelections,
    getColumnInfos,
    viewMode,
    nodeColors,
    resolveNodeIdForKey,
  ]);
}
