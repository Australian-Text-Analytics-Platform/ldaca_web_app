import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFiles } from '../useFiles';
import { queryKeys } from '@/lib/queryKeys';

const mocks = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  downloadFile: vi.fn(),
  listUserFiles: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  deleteFile: mocks.deleteFile,
  downloadFile: mocks.downloadFile,
  listUserFiles: mocks.listUserFiles,
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
    mocks.listUserFiles.mockResolvedValue({ data: [] });
    mocks.uploadFile.mockResolvedValue({ data: { message: 'uploaded' } });
    mocks.deleteFile.mockResolvedValue({ data: { message: 'deleted' } });
  });

  it('invalidates once per rapid upload and exposes manual refresh as a distinct command', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const replacedPreviewKey = queryKeys.filePreview('a.csv', 1, 20, null);
    queryClient.setQueryData(replacedPreviewKey, { rows: [{ stale: true }] });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useFiles(), {
      wrapper: makeWrapper(queryClient),
    });
    await waitFor(() => {
      expect(mocks.listUserFiles).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await Promise.all([
        result.current.handleUploadFile(new File(['a'], 'a.csv')),
        result.current.handleUploadFile(new File(['b'], 'b.csv')),
      ]);
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(replacedPreviewKey)).toBeUndefined();
    expect(result.current).not.toHaveProperty('refetchFiles');
    expect(result.current).toHaveProperty('refreshFiles');

    invalidateQueries.mockClear();
    await act(async () => {
      await result.current.handleDeleteFile('a.csv');
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(1);

    invalidateQueries.mockClear();
    const readsBeforeRefresh = mocks.listUserFiles.mock.calls.length;
    await act(async () => {
      await result.current.refreshFiles();
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(mocks.listUserFiles).toHaveBeenCalledTimes(readsBeforeRefresh + 1);
  });

  it('keeps directories but hides User Files that are not loadable', async () => {
    mocks.listUserFiles.mockResolvedValue({
      data: [
        {
          name: 'figures',
          path: 'figures',
          type: 'directory',
          size_bytes: null,
          file_type: null,
          modified_at: 1,
          loadable: false,
        },
        {
          name: 'chart.png',
          path: 'figures/chart.png',
          type: 'file',
          size_bytes: 64,
          file_type: 'unknown',
          modified_at: 1,
          loadable: false,
        },
        {
          name: 'records.csv',
          path: 'records.csv',
          type: 'file',
          size_bytes: 32,
          file_type: 'csv',
          modified_at: 1,
          loadable: true,
        },
      ],
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useFiles(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.fileTree).toEqual([
        {
          name: 'figures',
          path: 'figures',
          type: 'directory',
          children: [],
        },
        {
          name: 'records.csv',
          path: 'records.csv',
          type: 'file',
          size: 32,
          size_bytes: 32,
          modified_at: 1,
          file_type: 'csv',
          loadable: true,
        },
      ]);
    });
  });
});
