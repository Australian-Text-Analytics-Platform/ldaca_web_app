import type { WorkspaceGraphNode, WorkspaceNodeInfo } from '@/api';

/**
 * Handwritten view model shared by node selectors and document/schema consumers.
 * It is projected only from generated graph/node-info responses, so UI code does
 * not need transport aliases or nested fallback shapes.
 */
export interface WorkspaceNodeMetadata {
  id: string;
  name: string;
  color: string | null;
  document: string | null;
  columns: string[];
  schema: Record<string, string>;
  shape: WorkspaceNodeInfo['shape'];
  tokenizerModels: Record<string, string>;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Projects lightweight graph state plus optional full node-info metadata into
 * the one handwritten workspace-node model used by feature code.
 *
 * Used by: `useTabNodeInputs`, after its batched node-info request resolves.
 * Graph state owns current action availability; node info owns columns, schema,
 * document preference, shape, tokenizer metadata, and the canonical label.
 */
export const projectWorkspaceNodeMetadata = (
  graphNode: WorkspaceGraphNode,
  nodeInfo?: WorkspaceNodeInfo,
): WorkspaceNodeMetadata => ({
  id: graphNode.id,
  name: nodeInfo?.name ?? graphNode.name,
  color: nodeInfo?.color ?? graphNode.color ?? null,
  document: nodeInfo?.document ?? graphNode.document ?? null,
  columns: nodeInfo?.columns ?? [],
  schema: nodeInfo?.schema ?? {},
  shape: nodeInfo?.shape,
  tokenizerModels: nodeInfo?.tokenizer_models ?? {},
  canUndo: Boolean(graphNode.can_undo),
  canRedo: Boolean(graphNode.can_redo),
});
