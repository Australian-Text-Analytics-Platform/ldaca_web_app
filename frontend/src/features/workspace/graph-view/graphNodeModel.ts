import type { WorkspaceGraphNode } from '@/api';

/** Exact node-card data rendered by React Flow's `CustomNode`. */
export interface WorkspaceGraphNodeCard {
  id: string;
  name: string;
  color: string | null;
  shape: [number | null, number | null];
  canUndo: boolean;
  canRedo: boolean;
}

/** Projects the generated graph node once before it crosses into React Flow state. */
export const projectWorkspaceGraphNodeCard = (
  node: WorkspaceGraphNode,
): WorkspaceGraphNodeCard => ({
  id: node.id,
  name: node.name,
  color: node.color ?? null,
  shape: [null, null],
  canUndo: node.can_undo,
  canRedo: node.can_redo,
});
