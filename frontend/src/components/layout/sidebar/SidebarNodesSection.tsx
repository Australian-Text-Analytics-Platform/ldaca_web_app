import React from 'react';
import { X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { SidebarWorkspaceNode } from './types';

type SidebarNodesSectionProps = {
  nodes: SidebarWorkspaceNode[];
  selectedNodeIds?: string[];
  onToggleNodeSelection: (nodeId: string) => void;
  onClearSelection?: () => void;
};

const formatShapeLabel = (node: SidebarWorkspaceNode): string => {
  const rawShape = node.data?.shape || (node as { shape?: [number | null, number | null] }).shape;
  if (!rawShape) {
    return '—';
  }
  const [rows, cols] = rawShape;
  const formatPart = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '?';
  return `${formatPart(rows)} × ${formatPart(cols)}`;
};

const getNodeDisplayName = (node: SidebarWorkspaceNode): string =>
  node?.data?.nodeName || node?.data?.label || node?.label || node?.name || node.id;

const isActivationKey = (event: React.KeyboardEvent<HTMLDivElement>): boolean =>
  event.key === 'Enter' || event.key === ' ';

const SidebarNodesSection: React.FC<SidebarNodesSectionProps> = ({
  nodes,
  selectedNodeIds,
  onToggleNodeSelection,
  onClearSelection,
}) => {
  const nodeCount = nodes.length;
  const selectedCount = selectedNodeIds?.length ?? 0;

  // Order: selected nodes first in reverse selection order (latest first),
  // followed by unselected nodes sorted alphabetically (case-insensitive) by display name.
  const orderedNodes = (() => {
    const selectedIds = selectedNodeIds ?? [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const selectedSet = new Set(selectedIds);
    const selectedOrdered: SidebarWorkspaceNode[] = [];
    for (let i = selectedIds.length - 1; i >= 0; i -= 1) {
      const node = nodeById.get(selectedIds[i]!);
      if (node) selectedOrdered.push(node);
    }
    const unselectedSorted = nodes
      .filter((node) => !selectedSet.has(node.id))
      .sort((a, b) =>
        getNodeDisplayName(a).localeCompare(getNodeDisplayName(b), undefined, { sensitivity: 'base' }),
      );
    return [...selectedOrdered, ...unselectedSorted];
  })();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Total: {nodeCount}</span>
        <div className="flex items-center gap-1">
          <span>Selected: {selectedCount}</span>
          {selectedCount > 0 && onClearSelection && (
            <button
              type="button"
              onClick={onClearSelection}
              title="Clear selection"
              className="rounded p-0.5 hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <div className="space-y-2 pr-1">
        {orderedNodes.length ? (
          orderedNodes.map((node) => {
            const displayName = getNodeDisplayName(node) || 'Untitled data block';
            const shape = formatShapeLabel(node);
            const checked = selectedNodeIds?.includes(node.id) ?? false;
            const tooltip = `${displayName}\nShape: ${shape}`;

            return (
              <div
                key={node.id}
                onClick={() => onToggleNodeSelection(node.id)}
                onKeyDown={(event) => {
                  if (!isActivationKey(event)) {
                    return;
                  }
                  event.preventDefault();
                  onToggleNodeSelection(node.id);
                }}
                title={tooltip}
                role="button"
                tabIndex={0}
                aria-pressed={checked}
                aria-label={`${checked ? 'Deselect' : 'Select'} ${displayName}`}
                className={cn(
                  'group relative flex w-full items-center gap-3 overflow-hidden rounded-md border border-transparent bg-background/40 px-2 py-2 text-left text-sm transition-colors duration-150 ease-out focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
                  checked
                    ? 'border-primary/60 bg-primary/10'
                    : 'hover:border-border/60 hover:bg-accent/60',
                )}
              >
                <Checkbox
                  checked={checked}
                  tabIndex={-1}
                  aria-hidden="true"
                  className="pointer-events-none h-5 w-5 shrink-0 rounded-full border-border/70 text-primary-foreground data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                />
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">
                  {displayName}
                </span>
              </div>
            );
          })
        ) : (
          <div className="rounded-md bg-accent/40 px-2 py-2 text-xs text-muted-foreground">No data blocks</div>
        )}
      </div>
    </div>
  );
};

export default SidebarNodesSection;
