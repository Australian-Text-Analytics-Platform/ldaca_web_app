import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalysisStore } from '@/stores/analysisStore';
import { usePendingWorkspaceDownloads } from '../usePendingWorkspaceDownloads';

const { downloadWorkspaceArtifact, saveBlob, startWorkspaceDownload } = vi.hoisted(() => ({
  downloadWorkspaceArtifact: vi.fn(),
  saveBlob: vi.fn(),
  startWorkspaceDownload: vi.fn(),
}));

vi.mock('@/api', () => ({
  /** Used by: usePendingWorkspaceDownloads tests to inspect generated SDK call payloads. */
  downloadWorkspaceArtifact,
  /** Used by: usePendingWorkspaceDownloads tests to inspect generated SDK call payloads. */
  startWorkspaceDownload,
}));

vi.mock('@/lib/download', () => ({
  /** Used by: usePendingWorkspaceDownloads tests to avoid writing files while asserting artifact flow. */
  saveBlob,
}));

describe('usePendingWorkspaceDownloads', () => {
  const authHeaders = { Authorization: 'Bearer token' };

  beforeEach(() => {
    vi.clearAllMocks();
    useAnalysisStore.setState({ tasks: [] });
    startWorkspaceDownload.mockResolvedValue({
      data: { metadata: { task_id: 'task-1' } },
    });
    downloadWorkspaceArtifact.mockResolvedValue({ data: new Blob(['zip']) });
    saveBlob.mockResolvedValue(undefined);
  });

  it('starts workspace downloads with the row workspace id in the path', async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => usePendingWorkspaceDownloads({ authHeaders, notify }));

    await act(async () => {
      await result.current.startDownload('workspace-1', 'Main Workspace');
    });

    expect(startWorkspaceDownload).toHaveBeenCalledWith({
      headers: authHeaders,
      path: { workspace_id: 'workspace-1' },
      throwOnError: true,
    });
  });

  it('fetches completed workspace artifacts with the original workspace id', async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => usePendingWorkspaceDownloads({ authHeaders, notify }));

    await act(async () => {
      await result.current.startDownload('workspace-1', 'Main Workspace');
    });
    act(() => {
      useAnalysisStore.getState().setTasks([{ task_id: 'task-1', state: 'successful' }]);
    });

    await waitFor(() => {
      expect(downloadWorkspaceArtifact).toHaveBeenCalledWith({
        headers: authHeaders,
        parseAs: 'blob',
        path: { workspace_id: 'workspace-1', task_id: 'task-1' },
        throwOnError: true,
      });
    });
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'Main_Workspace.zip');
  });
});
