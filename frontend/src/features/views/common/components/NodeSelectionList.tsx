import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

export interface NodeSelectionRenderArgs {
  node: WorkspaceNodeMetadata;
  nodeId: string;
  index: number;
  color: string;
}

export interface NodeSelectionListProps {
  nodes?: WorkspaceNodeMetadata[];
  nodeIds?: string[];
  palette: string[];
  nodeColors?: Record<string, string>;
  maxCompare: number;
  /** When provided, each card shows an × button that removes that node from the inputs. */
  onRemoveNode?: (nodeId: string) => void;
  renderNodeMeta?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  renderNodeBody?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  renderExtraNodeContent?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  getNodeTitle?: (node: WorkspaceNodeMetadata, nodeId: string, index: number) => string;
  emptyState?: React.ReactNode;
  className?: string;
  cardClassName?: string;
}

/**
 * Displays the selected analysis data blocks as horizontally scrollable cards,
 * with feature-provided per-node content slots. Each card is assigned a stable
 * palette colour by position so chart legends and metadata slots stay
 * consistent; callers can use the render slots to place matching controls in
 * the card body.
 * Used by: NodeInputsPanel and shared node-selection tests.
 */
export function NodeSelectionList({
  nodes = [],
  nodeIds,
  palette,
  nodeColors,
  maxCompare,
  onRemoveNode,
  renderNodeMeta,
  renderNodeBody,
  renderExtraNodeContent,
  getNodeTitle = (node) => node.name,
  emptyState,
  className,
  cardClassName,
}: NodeSelectionListProps) {
  const derivedNodeIds = nodeIds?.length === nodes.length ? nodeIds : nodes.map((node) => node.id);

  // Auto-scroll to the right end when the selection changes so the
  // most recently selected data blocks are always visible.
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeIdsKey = derivedNodeIds.join('|');
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [nodeIdsKey]);

  if (!nodes.length) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        'flex gap-2.5 px-3 pb-2 pt-0',
        nodes.length > maxCompare ? 'overflow-x-auto' : 'overflow-x-hidden',
        className,
      )}
    >
      {nodes.map((node, index) => {
        const nodeId = derivedNodeIds[index];
        if (!nodeId) return null;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- palette index is always in range with the '#000000' fallback
        const fallbackColor = (palette.length ? palette[index % palette.length] : '#000000')!;
        const color = nodeColors?.[nodeId] ?? fallbackColor;
        const title = getNodeTitle(node, nodeId, index);
        return (
          <Card
            key={nodeId}
            className={cn(
              'relative border border-border/60 bg-card shadow-sm transition-colors',
              nodes.length > maxCompare ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0',
              cardClassName,
            )}
          >
            {onRemoveNode && (
              <button
                type="button"
                aria-label={`Remove ${title}`}
                title={`Remove ${title}`}
                onClick={() => {
                  onRemoveNode(nodeId);
                }}
                className={cn(
                  'pointer-events-auto absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-muted/80 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground',
                )}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
            <CardHeader className={cn('space-y-1 px-3 pb-1.5 pt-2.5')}>
              <div
                className="max-w-full wrap-break-word pr-6 text-sm font-semibold leading-snug text-foreground"
                title={title}
              >
                {title}
              </div>
              {renderNodeMeta && (
                <div className="text-xs text-muted-foreground">
                  {renderNodeMeta({ node, nodeId, index, color })}
                </div>
              )}
            </CardHeader>
            {(renderNodeBody ?? renderExtraNodeContent) && (
              <CardContent className="space-y-2 px-3 pb-3 pt-0">
                {renderNodeBody?.({ node, nodeId, index, color })}
                {renderExtraNodeContent?.({ node, nodeId, index, color })}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
