import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataFolderDialog } from '../DataFolderDialog';
import { queryKeys } from '@/lib/queryKeys';

const refreshAuth = vi.fn();
const setCurrentWorkspace = vi.fn();
const updateConfig = vi.fn();

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  updateConfig: (...args: unknown[]) => updateConfig(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    dataFolder: '/tmp/original',
    refreshAuth,
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    currentWorkspaceId: 'ws-1',
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    setCurrentWorkspace,
  }),
}));

describe('DataFolderDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshAuth.mockResolvedValue(undefined);
    setCurrentWorkspace.mockResolvedValue(undefined);
    updateConfig.mockResolvedValue({ data: { data_root: '/tmp/updated', multi_user_mode: false } });
  });

  it('unloads the active workspace before changing directories and refreshes workspace and file lists after', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const refetchQueriesSpy = vi.spyOn(queryClient, 'refetchQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <DataFolderDialog open onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );

    await user.clear(screen.getByLabelText('Path'));
    await user.type(screen.getByLabelText('Path'), '/tmp/updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(refreshAuth).toHaveBeenCalled();
    });

    expect(setCurrentWorkspace).toHaveBeenCalledWith(null);
    expect(updateConfig).toHaveBeenCalledWith({ body: { data_root: '/tmp/updated' }, throwOnError: true });

    expect(setCurrentWorkspace.mock.invocationCallOrder[0]!).toBeLessThan(updateConfig.mock.invocationCallOrder[0]!);
    expect(updateConfig.mock.invocationCallOrder[0]!).toBeLessThan(refreshAuth.mock.invocationCallOrder[0]!);

    await waitFor(() => {
      expect(refetchQueriesSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.workspaces,
        exact: true,
      });
    });

    expect(refetchQueriesSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.files,
    });
  });
});
