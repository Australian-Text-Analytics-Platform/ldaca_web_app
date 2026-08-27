import { DataBlockName } from '@/components/DataBlockName';
import { CardHeader, CardTitle } from '@/components/ui/card';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { GREY, foregroundForVizColor } from '@/features/views/common/vizPalette';
import { normalizeNodeColor } from '@/lib/nodeColor';

interface SourceHeaderProps {
  name: string;
  color?: string | null;
  testId: string;
}

/** Shared saturated Data Block header for separated Concordance results. */
export function ConcordanceSourceResultHeader({ name, color, testId }: SourceHeaderProps) {
  const sourceColor = normalizeNodeColor(color) ?? GREY;

  return (
    <CardHeader
      data-testid={testId}
      className="space-y-0 px-4 py-3"
      style={{ backgroundColor: sourceColor, color: foregroundForVizColor(sourceColor) }}
    >
      <CardTitle className="min-w-0 text-body">
        <DataBlockName
          name={name}
          backgroundColor={sourceColor}
          maxLines={2}
          fadeEdge="head"
          className="font-semibold leading-snug"
          title={name}
        />
      </CardTitle>
    </CardHeader>
  );
}

interface CombinedHeaderProps {
  nodes: readonly WorkspaceNodeMetadata[];
  sourceColorMap: Record<string, string>;
  defaultPalette: readonly string[];
  testId: string;
}

/** Shared neutral header and source-color legend for combined Concordance results. */
export function ConcordanceCombinedResultHeader({
  nodes,
  sourceColorMap,
  defaultPalette,
  testId,
}: CombinedHeaderProps) {
  return (
    <CardHeader
      data-testid={testId}
      className="gap-2 space-y-0 border-b border-surface-border bg-panel"
    >
      <CardTitle className="text-heading-3 text-foreground">Combined Results</CardTitle>
      <div
        role="list"
        aria-label="Source Data Blocks"
        className="flex flex-wrap items-center gap-2"
      >
        {nodes.map((node, index) => {
          const mappedColor =
            sourceColorMap[node.id.toLowerCase()] ??
            sourceColorMap[node.name.toLowerCase()] ??
            defaultPalette[index % defaultPalette.length];
          const color = normalizeNodeColor(mappedColor) ?? GREY;
          return (
            <div
              key={node.id}
              role="listitem"
              data-testid={`concordance-source-chip-${node.id}`}
              className="flex min-w-0 max-w-80 items-center rounded-sm px-2 py-1"
              style={{ backgroundColor: color, color: foregroundForVizColor(color) }}
            >
              <DataBlockName
                name={node.name}
                backgroundColor={color}
                maxLines={1}
                fadeEdge="head"
                className="text-label-secondary font-semibold leading-snug"
                title={node.name}
              />
            </div>
          );
        })}
      </div>
    </CardHeader>
  );
}
