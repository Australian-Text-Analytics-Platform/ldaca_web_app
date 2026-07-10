import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceTabsState } from '@/api';
import { useWorkspaceTabs } from '../useWorkspaceTabs';

const { getWorkspaceTabsMock, putWorkspaceTabsMock, clearTaskMock } = vi.hoisted(() => ({
  getWorkspaceTabsMock: vi.fn(),
  putWorkspaceTabsMock: vi.fn(),
  clearTaskMock: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getWorkspaceTabs: getWorkspaceTabsMock,
  putWorkspaceTabs: putWorkspaceTabsMock,
  clearTask: clearTaskMock,
}));

const ANALYSIS_TYPE = 'concordance_analysis';

/** Two tabs: one owns a backend task id, one does not. */
function initialState(): WorkspaceTabsState {
  return {
    groups: {
      [ANALYSIS_TYPE]: {
        active_tab_id: 'tab-with-task',
        tabs: [
          {
            tab_id: 'tab-with-task',
            task_id: 'task-1',
            title: 'A',
            input_sets: { source: [] },
            settings: {},
          },
          {
            tab_id: 'tab-no-task',
            task_id: null,
            title: 'B',
            input_sets: { source: [] },
            settings: {},
          },
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
    clearTaskMock.mockReset();
    clearTaskMock.mockResolvedValue({ data: { cleared: true }, error: undefined });
  });

  it('clears the backend task when a tab that owns a task id is closed', async () => {
    const { result } = renderHook(
      () => useWorkspaceTabs('workspace-1', ANALYSIS_TYPE),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2);
    });

    act(() => {
      result.current.closeTab('tab-with-task');
    });

    expect(clearTaskMock).toHaveBeenCalledWith({
      path: { task_id: 'task-1' },
      throwOnError: true,
    });
  });

  it('does not call clearTask when the closed tab owns no task id', async () => {
    const { result } = renderHook(
      () => useWorkspaceTabs('workspace-1', ANALYSIS_TYPE),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2);
    });

    act(() => {
      result.current.closeTab('tab-no-task');
    });

    expect(clearTaskMock).not.toHaveBeenCalled();
  });
});

describe('useWorkspaceTabs setTabSetting', () => {
  beforeEach(() => {
    getWorkspaceTabsMock.mockReset();
    getWorkspaceTabsMock.mockResolvedValue({ data: initialState(), error: undefined });
    putWorkspaceTabsMock.mockReset();
    putWorkspaceTabsMock.mockImplementation(({ body }: { body: WorkspaceTabsState }) =>
      Promise.resolve({ data: body, error: undefined }),
    );
    clearTaskMock.mockReset();
    clearTaskMock.mockResolvedValue({ data: { cleared: true }, error: undefined });
  });

  it('persists a free-form tab setting through to the PUT body', async () => {
    const { result } = renderHook(
      () => useWorkspaceTabs('workspace-1', ANALYSIS_TYPE),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2);
    });

    act(() => {
      result.current.setTabSetting('tab-with-task', 'aiProvider', 'openai');
    });

    // The mutation PUTs the full state; the targeted tab carries the new setting.
    await waitFor(() => {
      expect(putWorkspaceTabsMock).toHaveBeenCalled();
    });
    const calls = putWorkspaceTabsMock.mock.calls;
    const lastArg = calls[calls.length - 1]?.[0] as { body: WorkspaceTabsState } | undefined;
    const body: WorkspaceTabsState | undefined = lastArg?.body;
    const updatedTab = body?.groups?.[ANALYSIS_TYPE]?.tabs?.find(
      (t) => t.tab_id === 'tab-with-task',
    );
    expect(updatedTab?.settings).toEqual({ aiProvider: 'openai' });
  });
});
