import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAnalysisStore } from '@/stores/analysisStore';
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
    useAnalysisStore.setState({ tasks: [], pendingConcordance: null });
  });

  it('refreshes the workspace analysis projection when the canonical SSE event arrives', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    renderHook(() => useWorkspaceTaskInbox('workspace-1'), { wrapper });

    await waitFor(() => expect(useAnalysisStore.getState().tasks.length).toBeGreaterThan(0));
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

    await waitFor(() => expect(useAnalysisStore.getState().tasks[0]?.task_id).toBe('analysis-1'));
    expect(useAnalysisStore.getState().tasks[0]).toMatchObject({
      state: 'successful',
      workspace_id: 'workspace-1',
    });
  });
});
