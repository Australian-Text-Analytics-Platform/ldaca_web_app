import { useEffect, useRef, useState } from 'react';

export interface UseColorStackAllocatorConfig {
  colors: string[];
  activeNodeIds: string[];
}

export interface UseColorStackAllocatorReturn {
  nodeColors: Record<string, string>;
  getColorForNode: (nodeId: string) => string | undefined;
}

/**
 * Stack-based color allocator for node selection.
 * 
 * Behavior:
 * - First selected node receives first color (blue)
 * - Second selected node receives second color (red)
 * - When node is unselected, its color returns to stack top
 * - Next selected node receives the top color from stack
 * - Selection order-based, not node identity-based
 * 
 * LIFO semantics: released colors are immediately available for reuse.
 */
export const useColorStackAllocator = (
  config: UseColorStackAllocatorConfig
): UseColorStackAllocatorReturn => {
  const { colors, activeNodeIds } = config;
  const activeNodeIdsKey = activeNodeIds.join('|');
  const colorsKey = colors.join('|');

  // Runtime state: ephemeral node-to-color assignments
  const [nodeColors, setNodeColors] = useState<Record<string, string>>({});
  
  // Internal refs for stack management (not part of render state)
  const stackRef = useRef<string[]>([...colors].reverse()); // Reverse so first pop gives first color
  const assignedRef = useRef<Map<string, string>>(new Map());
  const lastColorsKeyRef = useRef<string>(colorsKey);

  const areColorMapsEqual = (a: Record<string, string>, b: Record<string, string>): boolean => {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) {
      return false;
    }
    for (const key of aKeys) {
      if (a[key] !== b[key]) {
        return false;
      }
    }
    return true;
  };

  // Sync allocator with active node IDs
  useEffect(() => {
    if (lastColorsKeyRef.current !== colorsKey) {
      stackRef.current = [...colors].reverse();
      assignedRef.current.clear();
      lastColorsKeyRef.current = colorsKey;
    }

    const currentNodeIds = new Set(activeNodeIds);
    const previousNodeIds = new Set(assignedRef.current.keys());

    // Release: nodes that were assigned but are no longer active
    const toRelease = [...previousNodeIds].filter(id => !currentNodeIds.has(id));
    toRelease.forEach(nodeId => {
      const color = assignedRef.current.get(nodeId);
      if (color) {
        stackRef.current.push(color); // Return to stack top (LIFO)
        assignedRef.current.delete(nodeId);
      }
    });

    // Acquire: nodes that are active but not yet assigned
    const toAcquire = activeNodeIds.filter(id => !assignedRef.current.has(id));
    toAcquire.forEach(nodeId => {
      if (stackRef.current.length > 0) {
        const color = stackRef.current.pop();
        if (color !== undefined) {
          assignedRef.current.set(nodeId, color);
        }
      } else {
        // Fallback: if stack exhausted, no assignment (caller handles overflow)
        // This should rarely happen with 2-node max selection
      }
    });

    // Update render state only when assignment content changes
    const nextNodeColors = Object.fromEntries(assignedRef.current);
    setNodeColors((prev) => (areColorMapsEqual(prev, nextNodeColors) ? prev : nextNodeColors));
  }, [activeNodeIds, colors, activeNodeIdsKey, colorsKey]);

  const getColorForNode = (nodeId: string) => {
    return assignedRef.current.get(nodeId);
  };

  return {
    nodeColors,
    getColorForNode,
  };
};
