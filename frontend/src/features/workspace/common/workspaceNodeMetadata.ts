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
  tokenizerModel: string | null;
}

/**
 * Projects the complete graph resource into the one handwritten workspace-node
 * model used by feature code.
 *
 * Used by: `useTabNodeInputs`, after the Workspace graph query resolves.
 * Arrow schema is fetched independently through the node-schema query.
 */
export const projectWorkspaceNodeMetadata = (
  graphNode: WorkspaceNodeInfo,
): WorkspaceNodeMetadata => ({
  id: graphNode.id,
  name: graphNode.name,
  color: graphNode.color ?? null,
  document: graphNode.document ?? null,
  shape: graphNode.shape,
  tokenizerModel: graphNode.tokenizer_model ?? null,
});
