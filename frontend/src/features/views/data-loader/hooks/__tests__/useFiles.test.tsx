import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFiles } from '../useFiles';

const mocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  getUserFiles: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  deleteFile: mocks.deleteFile,
  downloadFile: mocks.downloadFile,
  getUserFiles: mocks.getUserFiles,
  uploadFile: mocks.uploadFile,
}));

/** Creates the real query-cache boundary used by useFiles mutation tests. */
function makeWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useFiles cache policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserFiles.mockResolvedValue({ data: [] });
    mocks.uploadFile.mockResolvedValue({ data: { message: 'uploaded' } });
    mocks.deleteFile.mockResolvedValue({ data: { message: 'deleted' } });
  });

  it('invalidates once per rapid upload and exposes manual refresh as a distinct command', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useFiles(), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => {
      expect(mocks.getUserFiles).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.all([
        result.current.handleUploadFile(new File(['a'], 'a.csv')),
        result.current.handleUploadFile(new File(['b'], 'b.csv')),
      ]);
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(result.current).not.toHaveProperty('refetchFiles');
    expect(result.current).toHaveProperty('refreshFiles');

    invalidateQueries.mockClear();
    await act(async () => {
      await result.current.handleDeleteFile('a.csv');
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    invalidateQueries.mockClear();
    const readsBeforeRefresh = mocks.getUserFiles.mock.calls.length;
    await act(async () => {
      await result.current.refreshFiles();
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.getUserFiles).toHaveBeenCalledTimes(readsBeforeRefresh + 1);
  });
});
