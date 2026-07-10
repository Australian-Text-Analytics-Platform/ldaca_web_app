import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFolderCreation } from '../useFolderCreation';

const mocks = vi.hoisted(() => ({ createFolder: vi.fn() }));

vi.mock('@/api/generated/sdk.gen', () => ({ createFolder: mocks.createFolder }));

describe('useFolderCreation cache policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createFolder.mockResolvedValue({ data: { path: 'notes' } });
  });

  it('invalidates the file tree once after creating a folder', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const notify = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useFolderCreation({ notify }), {
      wrapper,
    });

    act(() => {
      result.current.openCreateFolderDialog('', 'root');
      result.current.setNewFolderName('notes');
    });
    await act(async () => {
      await result.current.handleCreateFolder();
    });

    expect(mocks.createFolder).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('success', 'Folder "notes" created.');
  });
});
