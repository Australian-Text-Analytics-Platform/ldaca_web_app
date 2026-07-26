import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import { useDetectedColumnLanguage } from '../useDetectedColumnLanguage';

const mocks = vi.hoisted(() => ({
  detectLanguageIso6391: vi.fn(),
  queryWorkspaceSqlTable: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  queryWorkspaceSqlTable: mocks.queryWorkspaceSqlTable,
}));
vi.mock('@/lib/languageDetection', () => ({
  detectLanguageIso6391: mocks.detectLanguageIso6391,
}));

describe('useDetectedColumnLanguage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectLanguageIso6391.mockResolvedValue('en');
  });

  it('re-detects from a changed sampled revision without storing document text in the key', async () => {
    const sharedPrefix = 'same '.repeat(130);
    const firstText = `${sharedPrefix}first ending`;
    const secondText = `${sharedPrefix}second ending`;
    mocks.queryWorkspaceSqlTable
      .mockResolvedValueOnce({ rows: [{ text: firstText }], etag: '"revision-1"' })
      .mockResolvedValueOnce({ rows: [{ text: secondText }], etag: '"revision-2"' });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(
      () =>
        useDetectedColumnLanguage({
          workspaceId: 'workspace-1',
          nodeId: 'node-1',
          column: 'text',
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(mocks.detectLanguageIso6391).toHaveBeenCalledWith(firstText);
    });

    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.workspaceSql(
          'workspace-1',
          ['node-1'],
          'SELECT "text" FROM "node-1"',
          1,
          100,
        ),
        exact: true,
      });
    });

    await waitFor(() => {
      expect(mocks.detectLanguageIso6391).toHaveBeenCalledWith(secondText);
    });
    expect(mocks.detectLanguageIso6391).toHaveBeenCalledTimes(2);

    const serializedKeys = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    );
    expect(serializedKeys).not.toContain('first ending');
    expect(serializedKeys).not.toContain('second ending');
  });
});
