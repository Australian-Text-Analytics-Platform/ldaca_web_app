import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnnotationAiPreviewSession } from '../useAnnotationAiPreviewSession';

const mocks = vi.hoisted(() => ({
  getNodeRowsTable: vi.fn(),
  previewAnnotation: vi.fn(),
}));
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getNodeRowsTable: mocks.getNodeRowsTable,
  previewAnnotation: mocks.previewAnnotation,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useAnnotationAiPreviewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getNodeRowsTable.mockResolvedValue({
      rows: [{ text: 'hello' }],
      columns: ['text'],
      hasNext: false,
    });
    mocks.previewAnnotation.mockResolvedValue({
      data: { labels: [{ row_index: 0, label: 'greeting' }] },
    });
  });

  it('uses the canonical node rows and stateless annotation preview endpoints', async () => {
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
          isOpen: true,
          targetValid: true,
          onOpenChange: vi.fn(),
          prepareOpen: vi.fn(async () => true),
          onExplicitClose: vi.fn(),
        }),
      { wrapper },
    );

    await waitFor(() => expect(mocks.getNodeRowsTable).toHaveBeenCalled());
    expect(result.current.columns).toEqual({ text: 'text', annotation: 'label' });
    expect(result.current.isBusy).toBe(false);
  });
});
