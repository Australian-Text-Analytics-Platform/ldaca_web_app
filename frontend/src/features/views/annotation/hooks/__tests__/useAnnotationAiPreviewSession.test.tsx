import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationAiPreviewSession } from '../useAnnotationAiPreviewSession';

const mocks = vi.hoisted(() => ({
  queryWorkspaceSqlTable: vi.fn(),
  previewAnnotationWithProviderCredential: vi.fn(),
}));
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable: mocks.queryWorkspaceSqlTable,
}));
vi.mock('@/features/provider-credentials/providerCredentialRequests', () => ({
  previewAnnotationWithProviderCredential: mocks.previewAnnotationWithProviderCredential,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useAnnotationAiPreviewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryWorkspaceSqlTable.mockImplementation(async (options) => {
      const isClassData = options.body.node_ids[0] === 'classes-1';
      return {
        rows: isClassData
          ? [{ class: 'greeting', description: 'A greeting' }]
          : [{ text: 'hello' }],
        columns: isClassData ? ['class', 'description'] : ['text'],
        hasNext: false,
        etag: '"revision-1"',
      };
    });
    mocks.previewAnnotationWithProviderCredential.mockResolvedValue({
      data: { labels: [{ row_index: 0, label: 'greeting' }] },
    });
  });

  it('uses Workspace SQL and the stateless annotation preview endpoint', async () => {
    const { result } = renderHook(
      () =>
        useAnnotationAiPreviewSession({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          textColumn: 'text',
          annotationColumn: 'label',
          classNodeId: 'classes-1',
          classColumn: 'class',
          descriptionColumn: 'description',
          providerId: 'openrouter',
          model: 'model-1',
          systemPrompt: 'classify',
          temperature: 0,
          reasoningEnabled: false,
          reasoningEffort: 'medium',
          credentialRevision: 0,
          isOpen: true,
          targetValid: true,
          onOpenChange: vi.fn(),
          prepareOpen: vi.fn(async () => true),
          onExplicitClose: vi.fn(),
        }),
      { wrapper },
    );

    await waitFor(() => expect(mocks.queryWorkspaceSqlTable).toHaveBeenCalled());
    await waitFor(() => expect(mocks.previewAnnotationWithProviderCredential).toHaveBeenCalled());
    expect(mocks.previewAnnotationWithProviderCredential.mock.calls[0]?.[0].request).toEqual({
      text_column: 'text',
      annotation_column: 'label',
      classes: [{ name: 'greeting', description: 'A greeting' }],
      provider: 'openrouter',
      model: 'model-1',
      instruction: 'classify',
      temperature: 0,
      reasoning_enabled: false,
      reasoning_effort: 'medium',
      page: 1,
      page_size: 20,
    });
    expect(result.current.columns).toEqual({ text: 'text', annotation: 'label' });
    expect(result.current.isBusy).toBe(false);
  });
});
