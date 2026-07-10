import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileBrowserActions } from '../useFileBrowserActions';

const mocks = vi.hoisted(() => ({ moveFile: vi.fn() }));

vi.mock('@/api/generated/sdk.gen', () => ({
  getRawFile: vi.fn(),
  moveFile: mocks.moveFile,
}));

describe('useFileBrowserActions cache policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.moveFile.mockResolvedValue({ data: { message: 'moved' } });
  });

  it('invalidates once after a move while manual refresh remains explicit', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const refreshFiles = vi.fn().mockResolvedValue([]);
    const notify = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useFileBrowserActions({ authHeaders: {}, refreshFiles, notify }),
      { wrapper },
    );

    await act(async () => {
      await result.current.handleMoveFile('source.csv', 'target');
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(refreshFiles).not.toHaveBeenCalled();

    invalidateQueries.mockClear();
    await act(async () => {
      await result.current.handleRefreshFiles();
    });

    expect(refreshFiles).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
