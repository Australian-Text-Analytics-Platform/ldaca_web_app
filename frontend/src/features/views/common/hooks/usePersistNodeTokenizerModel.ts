import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateNode } from '@/api';
import { updateNodePreferenceCache } from './nodePreferenceCache';

/** Persists one Data Block's node-level tokenizer preference independently. */
/** Used by: Token Frequency and Concordance, the two features that expose the selector. */
export function usePersistNodeTokenizerModel({
  workspaceId,
}: {
  workspaceId: string | null | undefined;
}) {
  const queryClient = useQueryClient();

  return async (nodeId: string, model: string) => {
    if (!workspaceId) return null;
    try {
      const { data } = await updateNode({
        path: { workspace_id: workspaceId, node_id: nodeId },
        body: { tokenizer_model: model.trim() || null },
        throwOnError: true,
      });
      updateNodePreferenceCache(
        queryClient,
        workspaceId,
        nodeId,
        'tokenizer_model',
        data.tokenizer_model ?? null,
      );
      return data;
    } catch {
      toast.error('Could not save the tokenizer for this data block.');
      return null;
    }
  };
}
