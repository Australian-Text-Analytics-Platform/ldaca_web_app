import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceTabsState } from '@/api';
import { useSingleTabModeWorkspaceCleanup } from '../useSingleTabModeWorkspaceCleanup';
import { workspaceTabsQueryKey } from '../useWorkspaceTabs';

const { getWorkspaceTabsMock, putWorkspaceTabsMock, clearTaskMock } = vi.hoisted(() => ({
  getWorkspaceTabsMock: vi.fn(),
  putWorkspaceTabsMock: vi.fn(),
  clearTaskMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  getWorkspaceTabs: getWorkspaceTabsMock,
  putWorkspaceTabs: putWorkspaceTabsMock,
  clearTask: clearTaskMock,
}));

const workspaceTabsState: WorkspaceTabsState = {
  groups: {
    concordance_analysis: {
      active_tab_id: 'concordance-extra',
      tabs: [
        { tab_id: 'concordance-first', task_id: 'task-keep-a', title: 'A1', inputs: [] },
        { tab_id: 'concordance-extra', task_id: 'task-remove-a', title: 'A2', inputs: [] },
      ],
    },
    token_frequencies: {
      active_tab_id: 'frequency-third',
      tabs: [
        { tab_id: 'frequency-first', task_id: null, title: 'B1', inputs: [] },
        { tab_id: 'frequency-second', task_id: 'task-remove-b', title: 'B2', inputs: [] },
        { tab_id: 'frequency-third', task_id: null, title: 'B3', inputs: [] },
      ],
    },
  },
};

/** Fresh QueryClient wrapper so cleanup cache writes can be asserted in isolation. */
function makeWrapper(
  queryClient: QueryClient,
): ({ children }: { children: ReactNode }) => ReactNode {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSingleTabModeWorkspaceCleanup', () => {
  beforeEach(() => {
    getWorkspaceTabsMock.mockReset();
    getWorkspaceTabsMock.mockResolvedValue({ data: workspaceTabsState, error: undefined });
    putWorkspaceTabsMock.mockReset();
    putWorkspaceTabsMock.mockImplementation(({ body }: { body: WorkspaceTabsState }) =>
      Promise.resolve({ data: body, error: undefined }),
    );
    clearTaskMock.mockReset();
    clearTaskMock.mockResolvedValue({ data: { cleared: true }, error: undefined });
  });

  it('collapses every workspace tab group to its first tab and clears removed tasks', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });

    renderHook(
      () => {
        useSingleTabModeWorkspaceCleanup('workspace-1', false, () => ({
          Authorization: 'Bearer t',
        }));
      },
      { wrapper: makeWrapper(queryClient) },
    );

    const expectedState: WorkspaceTabsState = {
      groups: {
        concordance_analysis: {
          active_tab_id: 'concordance-first',
          tabs: [{ tab_id: 'concordance-first', task_id: 'task-keep-a', title: 'A1', inputs: [] }],
        },
        token_frequencies: {
          active_tab_id: 'frequency-first',
          tabs: [{ tab_id: 'frequency-first', task_id: null, title: 'B1', inputs: [] }],
        },
      },
    };

    await waitFor(() => {
      expect(putWorkspaceTabsMock).toHaveBeenCalledWith({
        body: expectedState,
        headers: { Authorization: 'Bearer t' },
        path: { workspace_id: 'workspace-1' },
        throwOnError: true,
      });
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(workspaceTabsQueryKey('workspace-1'))).toEqual(expectedState);
    });
    expect(clearTaskMock).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer t' },
      path: { task_id: 'task-remove-a' },
      throwOnError: true,
    });
    expect(clearTaskMock).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer t' },
      path: { task_id: 'task-remove-b' },
      throwOnError: true,
    });
    expect(clearTaskMock).toHaveBeenCalledTimes(2);
  });
});
