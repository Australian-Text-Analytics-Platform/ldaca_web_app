import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkspaceNodeLike } from '../nodeSelectionTypes';
import { getNodeDisplayName, getNodeIdentifier } from '../nodeSelectionTypes';
import { NodeColorPicker } from './NodeColorPicker';

export interface NodeSelectionRenderArgs {
  node: WorkspaceNodeLike;
  nodeId: string;
  index: number;
  color: string;
}

export interface NodeSelectionListProps {
  nodes?: WorkspaceNodeLike[];
  nodeIds?: string[];
  nodeColors: Record<string, string>;
  palette: string[];
  maxCompare: number;
  showColorPicker?: boolean;
  onColorChange?: (nodeId: string, color: string) => void;
  /** When provided, each card shows an × button that removes that node from the inputs. */
  onRemoveNode?: (nodeId: string) => void;
  renderNodeMeta?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  renderNodeBody?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  renderExtraNodeContent?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  getNodeTitle?: (node: WorkspaceNodeLike, nodeId: string, index: number) => string;
  emptyState?: React.ReactNode;
  className?: string;
  cardClassName?: string;
}

/**
 * Displays the selected analysis data blocks as horizontally scrollable cards,
 * with optional colour controls and feature-provided per-node content slots.
 * Used by: NodeInputsPanel and shared node-selection tests because callers need a shared analysis UI boundary with consistent props, event forwarding, and display rules.
 * Flow: normalize incoming props, derive display state, connect event handlers, then render the shared analysis UI.
 */
export function NodeSelectionList({
  nodes = [],
  nodeIds,
  nodeColors,
  palette,
  maxCompare,
  showColorPicker = true,
  onColorChange,
  onRemoveNode,
  renderNodeMeta,
  renderNodeBody,
  renderExtraNodeContent,
  getNodeTitle = getNodeDisplayName,
  emptyState,
  className,
  cardClassName,
}: NodeSelectionListProps) {
  const derivedNodeIds =
    nodeIds && nodeIds.length === nodes.length
      ? nodeIds
      : nodes.map((node, index) => getNodeIdentifier(node, index));

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
        const color = (nodeColors[nodeId] ||
          (palette.length ? palette[index % palette.length] : '#000000')) as string;
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
            {showColorPicker && onColorChange && (
              <div className="pointer-events-auto absolute right-2 top-2">
                <NodeColorPicker
                  color={color}
                  palette={palette}
                  onChange={(next) => onColorChange(nodeId, next)}
                />
              </div>
            )}
            {onRemoveNode && (
              <button
                type="button"
                aria-label={`Remove ${title}`}
                title={`Remove ${title}`}
                onClick={() => onRemoveNode(nodeId)}
                className={cn(
                  'pointer-events-auto absolute top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-muted/80 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground',
                  showColorPicker && onColorChange ? 'right-9' : 'right-2',
                )}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
            <CardHeader
              className={cn('space-y-1 px-3 pb-1.5', showColorPicker ? 'pt-3' : 'pt-2.5')}
            >
              <div
                className="max-w-full wrap-break-word pr-2 text-sm font-semibold leading-snug text-foreground"
                style={showColorPicker ? { color } : undefined}
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
            {(renderNodeBody || renderExtraNodeContent) && (
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
