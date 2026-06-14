import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceTabsState } from '@/api/generated/types.gen';
import { useWorkspaceTabs } from '../useWorkspaceTabs';

const { getWorkspaceTabsMock, putWorkspaceTabsMock, clearTasksMock } = vi.hoisted(() => ({
  getWorkspaceTabsMock: vi.fn(),
  putWorkspaceTabsMock: vi.fn(),
  clearTasksMock: vi.fn(),
}));

vi.mock('@/api/generated/sdk.gen', () => ({
  getWorkspaceTabs: getWorkspaceTabsMock,
  putWorkspaceTabs: putWorkspaceTabsMock,
  clearTasks: clearTasksMock,
}));

const ANALYSIS_TYPE = 'concordance_analysis';

/** Two tabs: one owns a backend task id, one does not. */
function initialState(): WorkspaceTabsState {
  return {
    groups: {
      [ANALYSIS_TYPE]: {
        active_tab_id: 'tab-with-task',
        tabs: [
          { tab_id: 'tab-with-task', task_id: 'task-1', title: 'A', inputs: [] },
          { tab_id: 'tab-no-task', task_id: null, title: 'B', inputs: [] },
        ],
      },
    },
  };
}

/** Fresh provider per render so cached tab state never leaks across tests. */
function makeWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useWorkspaceTabs closeTab cleanup', () => {
  beforeEach(() => {
    getWorkspaceTabsMock.mockReset();
    getWorkspaceTabsMock.mockResolvedValue({ data: initialState(), error: undefined });
    putWorkspaceTabsMock.mockReset();
    putWorkspaceTabsMock.mockImplementation(({ body }: { body: WorkspaceTabsState }) =>
      Promise.resolve({ data: body, error: undefined }),
    );
    clearTasksMock.mockReset();
    clearTasksMock.mockResolvedValue({ data: { cleared: true }, error: undefined });
  });

  it('clears the backend task when a tab that owns a task id is closed', async () => {
    const { result } = renderHook(
      () => useWorkspaceTabs('workspace-1', ANALYSIS_TYPE, () => ({ Authorization: 'Bearer t' })),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2);
    });

    act(() => {
      result.current.closeTab('tab-with-task');
    });

    expect(clearTasksMock).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer t' },
      query: { task_id: 'task-1' },
      throwOnError: true,
    });
  });

  it('does not call clearTasks when the closed tab owns no task id', async () => {
    const { result } = renderHook(
      () => useWorkspaceTabs('workspace-1', ANALYSIS_TYPE, () => ({})),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2);
    });

    act(() => {
      result.current.closeTab('tab-no-task');
    });

    expect(clearTasksMock).not.toHaveBeenCalled();
  });
});
