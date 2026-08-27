import { DataBlockName } from '@/components/DataBlockName';
import { CardHeader, CardTitle } from '@/components/ui/card';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';
import { GREY, VIZ_TINT_FOREGROUND, toBgColor } from '@/features/views/common/vizPalette';
import { normalizeNodeAccentColor } from '@/lib/nodeColor';

interface SourceHeaderProps {
  name: string;
  color?: string | null;
  testId: string;
}

/**
 * Shared tinted Data Block header for separated Concordance results: the block's light
 * background tint with a full-colour left spine, matching the sidebar and graph treatment.
 */
export function ConcordanceSourceResultHeader({ name, color, testId }: SourceHeaderProps) {
  const sourceColor = normalizeNodeAccentColor(color) ?? GREY;
  const tint = toBgColor(sourceColor);

  return (
    <CardHeader
      data-testid={testId}
      className="space-y-0 px-4 py-3"
      style={{
        backgroundColor: tint,
        color: VIZ_TINT_FOREGROUND,
        borderLeftColor: sourceColor,
        borderLeftWidth: 6,
        borderLeftStyle: 'solid',
      }}
    >
      <CardTitle className="min-w-0 text-body">
        <DataBlockName
          name={name}
          backgroundColor={tint}
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

/** Shared neutral header and tinted source-colour legend for combined Concordance results. */
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
          const color = normalizeNodeAccentColor(mappedColor) ?? GREY;
          const tint = toBgColor(color);
          return (
            <div
              key={node.id}
              role="listitem"
              data-testid={`concordance-source-chip-${node.id}`}
              className="flex min-w-0 max-w-80 items-center rounded-sm px-2 py-1"
              style={{
                backgroundColor: tint,
                color: VIZ_TINT_FOREGROUND,
                borderLeftColor: color,
                borderLeftWidth: 3,
                borderLeftStyle: 'solid',
              }}
            >
              <DataBlockName
                name={node.name}
                backgroundColor={tint}
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
