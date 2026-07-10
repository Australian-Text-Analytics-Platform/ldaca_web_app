import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/queryKeys';
import { useAnalysisStore } from '@/stores/analysisStore';
import { useWorkspaceTaskInbox } from '../useWorkspaceTaskInbox';
import type {
  TaskEventPayload,
  WorkspaceTaskStreamClientOptions,
} from '../useWorkspaceTaskStreamClient';

let emitTaskEvent: ((payload: TaskEventPayload) => void) | undefined;

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

/** Captures the real inbox event callback while replacing only the external SSE transport. */
vi.mock('../useWorkspaceTaskStreamClient', () => ({
  useWorkspaceTaskStreamClient: (options: WorkspaceTaskStreamClientOptions) => {
    emitTaskEvent = options.onEvent;
    return {
      status: 'open',
      error: null,
      reconnectAttempt: 0,
      lastEventTimestamp: null,
      reconnect: vi.fn(),
    };
  },
}));

describe('useWorkspaceTaskInbox file cache policy', () => {
  beforeEach(() => {
    emitTaskEvent = undefined;
    useAnalysisStore.setState({ tasks: [] });
  });

  it('invalidates files once across a successful LDaCA snapshot and incremental replay', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    const completedTask = {
      task_id: 'ldaca-task-1',
      task_type: 'ldaca_import',
      workspace_id: 'workspace-1',
      state: 'successful' as const,
    };
    /** Counts file-cache effects without conflating the inbox's graph invalidations. */
    const countFileInvalidations = () =>
      invalidateQueries.mock.calls.filter(([filters]) => filters?.queryKey === queryKeys.files)
        .length;

    act(() => {
      emitTaskEvent?.({ type: 'tasks_snapshot', tasks: [completedTask], timestamp: 1 });
    });
    expect(countFileInvalidations()).toBe(1);

    act(() => {
      emitTaskEvent?.({ type: 'tasks_snapshot', tasks: [completedTask], timestamp: 2 });
      emitTaskEvent?.({ type: 'task_changed', task: completedTask, timestamp: 3 });
    });
    expect(countFileInvalidations()).toBe(1);
  });
});
