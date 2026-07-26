import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';

import { queryKeys } from '@/lib/queryKeys';
import { analysisResponse } from '@/test/msw/fixtures';
import { server } from '@/test/msw/server';
import type { UserFileImport } from '@/api';
import { useTabAnalysisForest } from '@/features/views/common/hooks/useTabAnalysisForest';
import type { WorkspaceTaskStreamClientOptions } from '../useWorkspaceTaskStreamClient';
import { useTaskResources, useWorkspaceTaskInbox } from '../useWorkspaceTaskInbox';

let emitEvent: ((payload: unknown) => void) | undefined;
const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

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

const userFileImportResponse = (overrides: Partial<UserFileImport> = {}): UserFileImport => ({
  id: 'import-1',
  state: 'running',
  cancellation_requested_at: null,
  created_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:01Z',
  finished_at: null,
  revision: 1,
  progress: { fraction: 0.5, message: 'Importing' },
  error: null,
  request: { kind: 'sample', collection_id: 'sample-1' },
  result: null,
  ...overrides,
});

const importPage = (items: UserFileImport[]) => ({
  items,
  page: 1,
  page_size: 100,
  total_items: items.length,
  total_pages: items.length > 0 ? 1 : 0,
});

describe('useWorkspaceTaskInbox', () => {
  beforeEach(() => {
    emitEvent = undefined;
    mocks.toastError.mockReset();
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

  it('shares one paginated Analysis collection with Run All review consumers', async () => {
    const runAllAnalysis = analysisResponse({
      id: 'run-all-1',
      tab_id: 'tab-1',
      execution_scope: 'run_all',
      request: {
        kind: 'concordance_run_all',
        source: {
          kind: 'concordance',
          node_ids: ['node-1'],
          node_columns: { 'node-1': 'text' },
          node_tokenizer_models: {},
          search_word: 'word',
          num_left_tokens: 5,
          num_right_tokens: 5,
          regex: false,
          whole_word: true,
          case_sensitive: false,
          search_mode: 'regex',
        },
        metadata_columns: [],
        names: {},
      },
    });
    server.use(
      http.get('*/api/workspaces/:workspace_id/analyses', () =>
        HttpResponse.json({
          items: [runAllAnalysis],
          page: 1,
          page_size: 500,
          total_items: 1,
          total_pages: 1,
        }),
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const view = renderHook(
      () => ({
        resources: useTaskResources('workspace-1'),
        latestRunAll: useTabAnalysisForest('workspace-1', 'tab-1').latestRunAll,
      }),
      { wrapper },
    );

    await waitFor(() => expect(view.result.current.resources.tasks).toHaveLength(1));
    expect(view.result.current.latestRunAll?.id).toBe('run-all-1');
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

  it('cancels a User File Import and patches the returned resource into Query state', async () => {
    let resource = userFileImportResponse();
    server.use(
      http.get('*/api/user-file-imports', () => HttpResponse.json(importPage([resource]))),
      http.post('*/api/user-file-imports/:import_id/cancel', () => {
        resource = userFileImportResponse({
          state: 'cancelled',
          cancellation_requested_at: '2026-01-01T00:00:02Z',
          finished_at: '2026-01-01T00:00:02Z',
          progress: { fraction: 0.5, message: 'Cancelled' },
          revision: 2,
        });
        return HttpResponse.json(resource);
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    await waitFor(() =>
      expect(view.result.current.tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resource_type: 'user_file_import',
            task_id: 'import-1',
            state: 'running',
          }),
        ]),
      ),
    );
    act(() => {
      view.result.current.stopUserFileImport('import-1');
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.userFileImport('import-1'))).toMatchObject({
        id: 'import-1',
        state: 'cancelled',
      }),
    );
    await waitFor(() =>
      expect(view.result.current.tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ task_id: 'import-1', state: 'cancelled' }),
        ]),
      ),
    );
  });

  it('deletes a terminal User File Import, evicts its detail, and refreshes the list', async () => {
    let resources = [
      userFileImportResponse({
        state: 'succeeded',
        progress: { fraction: 1, message: 'Complete' },
        finished_at: '2026-01-01T00:00:03Z',
      }),
    ];
    server.use(
      http.get('*/api/user-file-imports', () => HttpResponse.json(importPage(resources))),
      http.delete('*/api/user-file-imports/:import_id', () => {
        resources = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.userFileImport('import-1'), resources[0]);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    await waitFor(() =>
      expect(view.result.current.tasks.some((task) => task.task_id === 'import-1')).toBe(true),
    );
    act(() => {
      view.result.current.clearUserFileImport('import-1');
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(queryKeys.userFileImport('import-1'))).toBeUndefined(),
    );
    await waitFor(() =>
      expect(view.result.current.tasks.some((task) => task.task_id === 'import-1')).toBe(false),
    );
  });

  it('preserves the import row and reports an error when deletion fails', async () => {
    const resource = userFileImportResponse({
      state: 'failed',
      error: { code: 'import_failed', message: 'Import failed' },
      finished_at: '2026-01-01T00:00:03Z',
    });
    server.use(
      http.get('*/api/user-file-imports', () => HttpResponse.json(importPage([resource]))),
      http.delete('*/api/user-file-imports/:import_id', () =>
        HttpResponse.json({ code: 'delete_failed', message: 'Delete failed' }, { status: 500 }),
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    await waitFor(() =>
      expect(view.result.current.tasks.some((task) => task.task_id === 'import-1')).toBe(true),
    );
    act(() => {
      view.result.current.clearUserFileImport('import-1');
    });

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(view.result.current.tasks.some((task) => task.task_id === 'import-1')).toBe(true);
  });
});
