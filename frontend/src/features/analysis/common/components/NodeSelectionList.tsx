import React, { useMemo } from 'react';
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
  renderNodeMeta?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  renderNodeBody?: (args: NodeSelectionRenderArgs) => React.ReactNode;
  getNodeTitle?: (node: WorkspaceNodeLike, nodeId: string, index: number) => string;
  emptyState?: React.ReactNode;
  className?: string;
  cardClassName?: string;
}

export const NodeSelectionList: React.FC<NodeSelectionListProps> = ({
  nodes = [],
  nodeIds,
  nodeColors,
  palette,
  maxCompare,
  showColorPicker = true,
  onColorChange,
  renderNodeMeta,
  renderNodeBody,
  getNodeTitle = getNodeDisplayName,
  emptyState,
  className,
  cardClassName,
}) => {
  const derivedNodeIds = useMemo(() => {
    if (nodeIds && nodeIds.length === nodes.length) {
      return nodeIds;
    }
    return nodes.map((node, index) => getNodeIdentifier(node, index));
  }, [nodeIds, nodes]);

  if (!nodes.length) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <div
      className={cn(
        'flex gap-3 px-4 pb-3 pt-0',
        nodes.length > maxCompare ? 'overflow-x-auto' : 'overflow-x-hidden',
        className
      )}
    >
      {nodes.map((node, index) => {
        const nodeId = derivedNodeIds[index];
        if (!nodeId) return null;
        const color = nodeColors[nodeId] || (palette.length ? palette[index % palette.length] : '#000000');
        const title = getNodeTitle(node, nodeId, index);
        return (
          <Card
            key={nodeId}
            className={cn(
              'relative border border-border/60 bg-card shadow-sm transition-colors',
              nodes.length > maxCompare ? 'flex-none min-w-[50%]' : 'flex-1 min-w-0',
              cardClassName
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
            <CardHeader className={cn('space-y-1.5 px-4 pb-2', showColorPicker ? 'pt-4' : 'pt-3')}>
              <div
                className="max-w-full break-words pr-2 text-sm font-semibold leading-snug text-foreground"
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
            {renderNodeBody && <CardContent className="space-y-2 px-4 pb-4 pt-0">{renderNodeBody({ node, nodeId, index, color })}</CardContent>}
          </Card>
        );
      })}
    </div>
  );
};

export default NodeSelectionList;
