import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceGraphResponse, WorkspaceNodeInfo } from '@/api';
import { queryKeys } from '@/lib/queryKeys';
import { usePersistNodeDocumentColumn } from '../usePersistNodeDocumentColumn';
import { usePersistNodeTokenizerModel } from '../usePersistNodeTokenizerModel';

const mocks = vi.hoisted(() => ({
  updateNode: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/api', () => ({ updateNode: mocks.updateNode }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

const nodeInfo = {
  id: 'node-a',
  name: 'Node A',
  document: 'old-document',
  tokenizer_model: 'old-tokenizer',
} as WorkspaceNodeInfo;

const createHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph('workspace-a'), {
    nodes: [nodeInfo],
    edges: [],
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const utils = renderHook(
    () => ({
      persistDocument: usePersistNodeDocumentColumn({ workspaceId: 'workspace-a' }),
      persistTokenizer: usePersistNodeTokenizerModel({ workspaceId: 'workspace-a' }),
    }),
    { wrapper },
  );
  return { queryClient, ...utils };
};

describe('node preference persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges document and tokenizer responses by field so neither overwrites the other', async () => {
    mocks.updateNode.mockImplementation(async ({ body }: { body: Record<string, unknown> }) => {
      if ('document' in body) {
        return {
          data: {
            ...nodeInfo,
            document: 'new-document',
            tokenizer_model: 'stale-tokenizer-response',
          },
        };
      }
      return {
        data: {
          ...nodeInfo,
          document: 'stale-document-response',
          tokenizer_model: 'new-tokenizer',
        },
      };
    });
    const { result, queryClient } = createHarness();

    await act(async () => {
      await Promise.all([
        result.current.persistDocument('node-a', 'new-document'),
        result.current.persistTokenizer('node-a', 'new-tokenizer'),
      ]);
    });

    expect(mocks.updateNode).toHaveBeenCalledWith(
      expect.objectContaining({ body: { document: 'new-document' } }),
    );
    expect(mocks.updateNode).toHaveBeenCalledWith(
      expect.objectContaining({ body: { tokenizer_model: 'new-tokenizer' } }),
    );
    const graph = queryClient.getQueryData<WorkspaceGraphResponse>(
      queryKeys.workspaceGraph('workspace-a'),
    );
    expect(graph?.nodes[0]).toMatchObject({
      document: 'new-document',
      tokenizer_model: 'new-tokenizer',
    });
  });

  it('sends null when clearing and keeps caches unchanged on failure', async () => {
    mocks.updateNode.mockResolvedValueOnce({
      data: { ...nodeInfo, tokenizer_model: null },
    });
    const { result, queryClient } = createHarness();

    await act(async () => {
      await result.current.persistTokenizer('node-a', '   ');
    });
    expect(mocks.updateNode).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: { tokenizer_model: null } }),
    );
    expect(
      queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph('workspace-a'))
        ?.nodes[0]?.tokenizer_model,
    ).toBeNull();

    mocks.updateNode.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      expect(await result.current.persistTokenizer('node-a', 'draft-model')).toBeNull();
    });
    expect(
      queryClient.getQueryData<WorkspaceGraphResponse>(queryKeys.workspaceGraph('workspace-a'))
        ?.nodes[0]?.tokenizer_model,
    ).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Could not save the tokenizer for this data block.',
    );
  });
});
