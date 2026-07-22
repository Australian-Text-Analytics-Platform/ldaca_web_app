import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { queryKeys } from '@/lib/queryKeys';
import { analysisResponse } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import type { WorkspaceTaskStreamClientOptions } from '../useWorkspaceTaskStreamClient';
import { useWorkspaceTaskInbox } from '../useWorkspaceTaskInbox';

let emitEvent: ((payload: unknown) => void) | undefined;

vi.mock('../useWorkspaceTaskStreamClient', () => ({
  useWorkspaceTaskStreamClient: (options: WorkspaceTaskStreamClientOptions) => {
    emitEvent = options.onEvent;
    return {
      status: 'open',
      error: null,
      reconnectAttempt: 0,
      lastEventTimestamp: null,
      reconnect: vi.fn(),
    };
  },
}));

describe('useWorkspaceTaskInbox', () => {
  beforeEach(() => {
    emitEvent = undefined;
  });

  it('refreshes the workspace analysis projection when the canonical SSE event arrives', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    await waitFor(() => expect(view.result.current.tasks.length).toBeGreaterThan(0));
    act(() => {
      emitEvent?.({
        type: 'resource_changed',
        sequence: 2,
        occurred_at: new Date().toISOString(),
        resource_type: 'analysis',
        resource_id: 'analysis-1',
        workspace_id: 'workspace-1',
        state: 'succeeded',
        progress: { fraction: 1, message: 'done' },
        revision: 2,
      });
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData(queryKeys.analysis('workspace-1', 'analysis-1')),
      ).toMatchObject({ id: 'analysis-1', state: 'succeeded' }),
    );
    expect(view.result.current.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task_id: 'analysis-1',
          state: 'successful',
          workspace_id: 'workspace-1',
        }),
      ]),
    );
  });

  it('drains every analysis page when rebuilding the Task Inbox', async () => {
    const requestedPages: string[] = [];
    server.use(
      http.get('*/api/workspaces/:workspace_id/analyses', ({ request }) => {
        const page = new URL(request.url).searchParams.get('page') ?? '1';
        requestedPages.push(page);
        return HttpResponse.json({
          items: [analysisResponse({ id: `analysis-${page}` })],
          page: Number(page),
          page_size: 500,
          total_items: 2,
          total_pages: 2,
        });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const view = renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    await waitFor(() => {
      expect(view.result.current.tasks.map((task) => task.task_id)).toEqual(
        expect.arrayContaining(['analysis-1', 'analysis-2']),
      );
    });
    expect(requestedPages).toEqual(['1', '2']);
  });

  it('invalidates the shared Tab cache for Tab events', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = queryKeys.workspaceTabs('workspace-1');
    queryClient.setQueryData(key, []);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    act(() => {
      emitEvent?.({
        type: 'resource_changed',
        sequence: 3,
        occurred_at: new Date().toISOString(),
        resource_type: 'tab',
        resource_id: 'tab-1',
        workspace_id: 'workspace-1',
        state: null,
        progress: null,
        revision: 2,
      });
    });

    await waitFor(() => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
  });
});
