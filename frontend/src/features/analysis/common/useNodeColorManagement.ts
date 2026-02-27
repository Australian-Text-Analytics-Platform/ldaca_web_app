import { useState } from 'react';
import { useColorStackAllocator } from './useColorStackAllocator';
import { DEFAULT_PALETTE } from './palette';

export interface UseNodeColorManagementConfig {
  activeNodeIds: string[];
  palette?: string[];
}

export interface UseNodeColorManagementReturn {
  nodeColors: Record<string, string>;
  handleColorChange: (nodeId: string, color: string) => void;
  defaultPalette: string[];
}

/**
 * Encapsulates stack-based color allocation with manual override support.
 *
 * - Stack allocator assigns colors in selection order
 * - Manual overrides take precedence for active nodes
 * - Overflow nodes fall back to palette cycling
 */
export function useNodeColorManagement(
  config: UseNodeColorManagementConfig,
): UseNodeColorManagementReturn {
  const { activeNodeIds, palette = DEFAULT_PALETTE } = config;
  const stackPalette = palette.slice(0, 6);

  const { nodeColors: stackColors } = useColorStackAllocator({
    colors: stackPalette,
    activeNodeIds,
  });

  const [manualColors, setManualColors] = useState<Record<string, string>>({});

  const nodeColors = (() => {
    const merged: Record<string, string> = {};
    Object.entries(stackColors).forEach(([id, color]) => {
      merged[id] = color;
    });
    Object.entries(manualColors).forEach(([id, color]) => {
      if (activeNodeIds.includes(id)) {
        merged[id] = color;
      }
    });
    activeNodeIds.forEach((id, index) => {
      if (!merged[id]) {
        merged[id] = palette[index % palette.length];
      }
    });
    return merged;
  })();

  const handleColorChange = (nodeId: string, color: string) =>
    setManualColors((p) => ({ ...p, [nodeId]: color }));

  return { nodeColors, handleColorChange, defaultPalette: palette };
}
