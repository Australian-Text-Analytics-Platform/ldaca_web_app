import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataFolderSettingsPanel } from '../DataFolderSettingsPanel';
import { queryKeys } from '@/lib/queryKeys';

const refreshAuth = vi.fn();
const setCurrentWorkspace = vi.fn();
const updateAdminConfig = vi.fn();

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  updateAdminConfig: (...args: unknown[]) => updateAdminConfig(...args),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
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

describe('DataFolderSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshAuth.mockResolvedValue(undefined);
    setCurrentWorkspace.mockResolvedValue(undefined);
    updateAdminConfig.mockResolvedValue({
      data: { data_root: '/tmp/updated', multi_user_mode: false },
    });
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
        <DataFolderSettingsPanel />
      </QueryClientProvider>,
    );

    await user.clear(screen.getByLabelText('Path'));
    await user.type(screen.getByLabelText('Path'), '/tmp/updated');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(refreshAuth).toHaveBeenCalled();
    });

    expect(setCurrentWorkspace).toHaveBeenCalledWith(null);
    expect(updateAdminConfig).toHaveBeenCalledWith({
      body: { data_root: '/tmp/updated' },
      throwOnError: true,
    });

    expect(setCurrentWorkspace.mock.invocationCallOrder[0]!).toBeLessThan(
      updateAdminConfig.mock.invocationCallOrder[0]!,
    );
    expect(updateAdminConfig.mock.invocationCallOrder[0]!).toBeLessThan(
      refreshAuth.mock.invocationCallOrder[0]!,
    );

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
