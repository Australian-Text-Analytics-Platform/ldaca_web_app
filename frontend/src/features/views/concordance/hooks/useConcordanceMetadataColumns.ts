import type {
  ConcordanceAnalysisResponse,
  ConcordanceNodeResult as ConcordanceResultEntry,
} from '@/api';
import type { NodeColumnSelection } from '../../common/nodeSelectionTypes';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { CONCORDANCE_COMBINED_NODE_KEY } from '../concordanceViewModels';

interface Section {
  columns: string[];
  color?: string;
  disabled?: boolean;
}

export interface ConcordanceMetadataColumnSet {
  availableMetadataColumns: string[];
  metadataColumnSections: Section[];
  metadataDisabledReason: string | undefined;
}

type GetColumnInfo = (node: WorkspaceNodeMetadata) => { name?: string }[];
type ResolveNodeIdForKey = (nodeKey: string) => string | null;

interface Params {
  results: ConcordanceAnalysisResponse | null;
  panelSelectedNodes: WorkspaceNodeMetadata[];
  effectiveNodeColumnSelections: NodeColumnSelection[];
  getColumnInfos: GetColumnInfo;
  viewMode: 'separated' | 'combined';
  nodeColors: Record<string, string>;
  resolveNodeIdForKey: ResolveNodeIdForKey;
}

/**
 * Compute the list of metadata columns + per-section visibility for the
 * Concordance feature. In Combined view, columns exclusive to one source can't
 * be rendered in the merged table — they'd be NULL for rows from the other
 * block — so we surface them as visible-but-disabled, and disable the whole
 * "Show metadata" UI when there are no columns common to all blocks.
 */
/**
 * Used by: ConcordanceFeature.tsx.
 * Flow: read result metadata or selected-node schemas, partition shared versus
 * source-exclusive columns, and disable exclusive sections in Combined view.
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
  const resultEntries = results?.data ?? {};
  const perBlock: { nodeKey: string; columns: string[] }[] = [];
  for (const [nodeKey, entry] of Object.entries(resultEntries)) {
    if (nodeKey === CONCORDANCE_COMBINED_NODE_KEY) continue;
    const nodeEntry: ConcordanceResultEntry = entry;
    const cols = nodeEntry.metadata.metadata_columns.filter((c) => c && c !== '__source_node');
    perBlock.push({ nodeKey, columns: cols });
  }
  if (perBlock.length === 0 && panelSelectedNodes.length > 0) {
    panelSelectedNodes.forEach((node) => {
      const rawId = node.id;
      const rawName = node.name;
      const nodeKey = rawName || rawId;
      const sel = effectiveNodeColumnSelections.find((s) => s.nodeId === rawId);
      const textColumn = sel?.column;
      const cols = getColumnInfos(node)
        .map((info) => info.name)
        .filter(
          (name): name is string => !!name && name !== textColumn && name !== '__source_node',
        );
      if (cols.length > 0) perBlock.push({ nodeKey, columns: cols });
    });
  }
  const allColumns = Array.from(new Set(perBlock.flatMap((b) => b.columns)));
  const sections: Section[] = [];
  let disabledReason: string | undefined;
  const isCombinedView = viewMode === 'combined';
  if (perBlock.length <= 1) {
    if (allColumns.length > 0) sections.push({ columns: allColumns });
  } else {
    const common =
      perBlock[0]?.columns.filter((c) => perBlock.every((b) => b.columns.includes(c))) ?? [];
    if (isCombinedView && common.length === 0 && perBlock.some((b) => b.columns.length > 0)) {
      disabledReason =
        'The selected data blocks share no metadata columns; nothing to display in Combined view.';
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
}
