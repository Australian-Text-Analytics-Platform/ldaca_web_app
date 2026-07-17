import type { WorkspaceNodeInfo } from '@/api';

/**
 * Handwritten view model shared by node selectors and document consumers.
 * It is projected only from generated graph/node-info responses, so UI code does
 * not need transport aliases or nested fallback shapes.
 */
export interface WorkspaceNodeMetadata {
  id: string;
  name: string;
  color: string | null;
  document: string | null;
  shape: WorkspaceNodeInfo['shape'];
  tokenizerModels: Record<string, string>;
}

/**
 * Projects lightweight graph state plus optional full node-info metadata into
 * the one handwritten workspace-node model used by feature code.
 *
 * Used by: `useTabNodeInputs`, after its batched node-info request resolves.
 * Graph state owns current identity and action availability; node info owns
 * document preference, shape, and tokenizer metadata. Arrow schema is fetched
 * independently through the node-schema query. This
 * keeps a stale hydrated node-info response from masking a newer graph rename.
 */
export const projectWorkspaceNodeMetadata = (
  graphNode: WorkspaceNodeInfo,
  nodeInfo?: WorkspaceNodeInfo,
): WorkspaceNodeMetadata => ({
  id: graphNode.id,
  name: graphNode.name,
  color: nodeInfo?.color ?? graphNode.color ?? null,
  document: nodeInfo?.document ?? graphNode.document ?? null,
  shape: nodeInfo?.shape,
  tokenizerModels: nodeInfo?.tokenizer_models ?? {},
});
