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

  it('invalidates files once when a successful LDaCA task emission repeats', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    const payload: TaskEventPayload = {
      type: 'task_changed',
      task: {
        task_id: 'ldaca-task-1',
        task_type: 'ldaca_import',
        workspace_id: 'workspace-1',
        state: 'successful',
      },
      timestamp: 1,
    };
    act(() => {
      emitTaskEvent?.(payload);
      emitTaskEvent?.(payload);
    });

    const fileInvalidations = invalidateQueries.mock.calls.filter(
      ([filters]) => filters?.queryKey === queryKeys.files,
    );
    expect(fileInvalidations).toHaveLength(1);
  });
});
