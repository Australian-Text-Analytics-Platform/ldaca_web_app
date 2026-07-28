import React, { useEffect, useRef } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { WorkspaceNodeMetadata } from '@/features/workspace/common/workspaceNodeMetadata';

export interface NodeSelectionRenderArgs {
  node: WorkspaceNodeMetadata;
  nodeId: string;
  index: number;
  color: string;
}

export interface UnavailableNodeSelection {
  id: string;
  name: string;
  column?: string;
}

export type NodeSelectionItem =
  | { kind: 'available'; id: string; node: WorkspaceNodeMetadata }
  | { kind: 'unavailable'; id: string; selection: UnavailableNodeSelection };

export interface NodeSelectionListProps {
  items: NodeSelectionItem[];
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
  items,
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
  // Auto-scroll to the right end when the selection changes so the
  // most recently selected data blocks are always visible.
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeIdsKey = items.map((item) => item.id).join('|');
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [nodeIdsKey]);

  if (!items.length) {
    return emptyState ? <>{emptyState}</> : null;
  }

  const isOverflowed = items.length > maxCompare;

  return (
    <ScrollArea
      data-testid="node-selection-scroll-area"
      viewportRef={scrollRef}
      scrollbars={isOverflowed ? 'horizontal' : 'none'}
      type="always"
      className={cn('w-full', className)}
    >
      <div className={cn('flex gap-2.5 px-3 pt-0', isOverflowed ? 'pb-4' : 'pb-2')}>
        {items.map((item, index) => {
          const nodeId = item.id;
          const node = item.kind === 'available' ? item.node : null;
          const unavailable = item.kind === 'unavailable' ? item.selection : null;
          const fallbackColor = palette[index % palette.length] ?? '#000000';
          const color = nodeColors?.[nodeId] ?? fallbackColor;
          const title = node ? getNodeTitle(node, nodeId, index) : (unavailable?.name ?? nodeId);
          return (
            <Card
              key={nodeId}
              role={unavailable ? 'group' : undefined}
              aria-label={unavailable ? `${title} unavailable` : undefined}
              className={cn(
                'relative border border-border/60 bg-card shadow-sm transition-colors',
                isOverflowed ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0',
                unavailable && 'border-amber-500/60 bg-amber-500/5',
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
                {node && renderNodeMeta && (
                  <div className="text-xs text-muted-foreground">
                    {renderNodeMeta({ node, nodeId, index, color })}
                  </div>
                )}
              </CardHeader>
              {unavailable ? (
                <CardContent className="space-y-2 px-3 pb-3 pt-0">
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs leading-snug text-amber-900 dark:text-amber-100"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      This Data Block no longer exists in the Workspace and cannot be used for a new
                      run.
                    </span>
                  </div>
                  {unavailable.column ? (
                    <div className="text-xs text-muted-foreground">
                      Selected column:{' '}
                      <span className="wrap-break-word font-medium text-foreground">
                        {unavailable.column}
                      </span>
                    </div>
                  ) : null}
                </CardContent>
              ) : (renderNodeBody ?? renderExtraNodeContent) && node ? (
                <CardContent className="space-y-2 px-3 pb-3 pt-0">
                  {renderNodeBody?.({ node, nodeId, index, color })}
                  {renderExtraNodeContent?.({ node, nodeId, index, color })}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </ScrollArea>
  );
}
