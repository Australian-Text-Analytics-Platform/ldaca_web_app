import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAnalysisStore } from '@/stores/analysisStore';
import { useAnalysisTaskStatus } from '../useAnalysisTaskStatus';

describe('useAnalysisTaskStatus', () => {
  afterEach(() => {
    useAnalysisStore.setState({ tasks: [] });
  });

  it('isolates same-type tasks by workspace and the owning tab task ids', () => {
    useAnalysisStore.setState({
      tasks: [
        {
          task_id: 'owned-task',
          task_type: 'token_frequencies',
          workspace_id: 'workspace-1',
          state: 'running',
          updated_at: '2026-07-10T00:00:00Z',
        },
        {
          task_id: 'sibling-task',
          task_type: 'token_frequencies',
          workspace_id: 'workspace-1',
          state: 'successful',
          updated_at: '2026-07-10T00:01:00Z',
        },
        {
          task_id: 'other-workspace-task',
          task_type: 'token_frequencies',
          workspace_id: 'workspace-2',
          state: 'failed',
          updated_at: '2026-07-10T00:02:00Z',
        },
      ],
    });

    const { result } = renderHook(() =>
      useAnalysisTaskStatus({
        taskTypes: ['token_frequencies'],
        workspaceId: 'workspace-1',
        taskIds: ['owned-task'],
      }),
    );

    expect(result.current.tasks.map((task) => task.task_id)).toEqual(['owned-task']);
    expect(result.current.runningTask?.task_id).toBe('owned-task');
    expect(result.current.terminalTask).toBeNull();
  });

  it('treats an explicitly empty task-id list as an unrun tab', () => {
    useAnalysisStore.setState({
      tasks: [
        {
          task_id: 'sibling-task',
          task_type: 'token_frequencies',
          workspace_id: 'workspace-1',
          state: 'running',
        },
      ],
    });

    const { result } = renderHook(() =>
      useAnalysisTaskStatus({
        taskTypes: 'token_frequencies',
        workspaceId: 'workspace-1',
        taskIds: [],
      }),
    );

    expect(result.current.tasks).toEqual([]);
    expect(result.current.activeTaskId).toBeNull();
  });

  it('lets non-tab flows omit task ids while retaining workspace and type scope', () => {
    useAnalysisStore.setState({
      tasks: [
        {
          task_id: 'workspace-task',
          task_type: 'quotation_materialize',
          workspace_id: 'workspace-1',
          state: 'successful',
        },
        {
          task_id: 'other-workspace-task',
          task_type: 'quotation_materialize',
          workspace_id: 'workspace-2',
          state: 'successful',
        },
      ],
    });

    const { result } = renderHook(() =>
      useAnalysisTaskStatus({
        taskTypes: 'quotation_materialize',
        workspaceId: 'workspace-1',
      }),
    );

    expect(result.current.tasks.map((task) => task.task_id)).toEqual(['workspace-task']);
  });
});
