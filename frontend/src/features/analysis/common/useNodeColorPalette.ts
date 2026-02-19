import { useCallback, useMemo, useState } from 'react';
import { useColorStackAllocator } from './useColorStackAllocator';

export interface PaletteNode {
  id: string;
  label?: string;
}

export interface UseNodeColorPaletteConfig {
  nodeIds?: string[];
  nodes?: PaletteNode[];
  palette?: string[];
}

export interface UseNodeColorPaletteReturn {
  nodeColors: Record<string, string>;
  setNodeColor: (nodeId: string, color: string) => void;
  getColorForNode: (nodeId?: string, fallbackIndex?: number) => string;
  palette: string[];
  legend: Array<{ id: string; label: string; color: string }>;
  getGradientForNodes: (a: string, b: string) => string;
}

const DEFAULT_PALETTE = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#d97706',
  '#0d9488',
  '#db2777',
  '#4f46e5',
  '#65a30d',
  '#0891b2',
  '#92400e',
  '#6b7280',
];

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

export const useNodeColorPalette = (
  config: UseNodeColorPaletteConfig = {}
): UseNodeColorPaletteReturn => {
  const { nodeIds = [], nodes = [], palette = DEFAULT_PALETTE } = config;
  const stackPalette = useMemo(() => palette.slice(0, 6), [palette]);
  
  // Use stack-based allocator for automatic color assignment
  const { nodeColors: stackColors } = useColorStackAllocator({
    colors: stackPalette, // Use first six palette colors in stack order
    activeNodeIds: nodeIds,
  });

  // Allow manual color overrides
  const [manualColors, setManualColors] = useState<Record<string, string>>({});

  // Merge stack-allocated and manually set colors
  const nodeColors = useMemo(() => {
    const merged: Record<string, string> = {};
    
    // Start with stack-allocated colors
    Object.entries(stackColors).forEach(([id, color]) => {
      merged[id] = color;
    });
    
    // Override with manual selections
    Object.entries(manualColors).forEach(([id, color]) => {
      if (nodeIds.includes(id)) {
        merged[id] = color;
      }
    });
    
    // Fallback for overflow (>6 nodes)
    nodeIds.forEach((id, index) => {
      if (!merged[id]) {
        merged[id] = palette[index % palette.length];
      }
    });
    
    return merged;
  }, [stackColors, manualColors, nodeIds, palette]);

  const setNodeColor = useCallback((nodeId: string, color: string) => {
    if (!nodeId || !color) return;
    setManualColors((prev) => {
      if (prev[nodeId] === color) return prev;
      return { ...prev, [nodeId]: color };
    });
  }, []);

  const getColorForNode = useCallback(
    (nodeId?: string, fallbackIndex = 0) => {
      if (nodeId && nodeColors[nodeId]) {
        return nodeColors[nodeId];
      }
      const index = nodeId ? hashString(nodeId) : fallbackIndex;
      return palette[index % palette.length];
    },
    [nodeColors, palette]
  );

  const legend = useMemo(() => {
    return nodes.map((node, index) => ({
      id: node.id,
      label: node.label ?? node.id,
      color: getColorForNode(node.id, index),
    }));
  }, [nodes, getColorForNode]);

  const getGradientForNodes = useCallback(
    (a: string, b: string) => {
      const start = getColorForNode(a, 0);
      const end = getColorForNode(b, 1);
      return `linear-gradient(90deg, ${start}, ${end})`;
    },
    [getColorForNode]
  );

  return {
    nodeColors,
    setNodeColor,
    getColorForNode,
    palette,
    legend,
    getGradientForNodes,
  };
};
