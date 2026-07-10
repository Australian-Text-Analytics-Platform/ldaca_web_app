import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalysisStore } from '@/stores/analysisStore';
import { WorkspaceDownloadsProvider } from '../WorkspaceDownloadsProvider';
import { useWorkspaceDownloads } from '../WorkspaceDownloadsContext';

const mocks = vi.hoisted(() => ({
  downloadWorkspaceArtifact: vi.fn(),
  saveBlob: vi.fn(),
  startWorkspaceDownload: vi.fn(),
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadWorkspaceArtifact: mocks.downloadWorkspaceArtifact,
  startWorkspaceDownload: mocks.startWorkspaceDownload,
}));

vi.mock('@/lib/download', () => ({
  saveBlob: mocks.saveBlob,
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));

/**
 * Exposes the provider command used by the workspace-manager row. The test
 * removes this consumer after starting a task to model navigating away from
 * Data Loader while leaving the shell-level provider mounted.
 */
function DownloadStarter() {
  const downloads = useWorkspaceDownloads();
  return (
    <button
      type="button"
      onClick={() => {
        void downloads.startDownload('workspace-1', 'Main Workspace');
      }}
    >
      Start download
    </button>
  );
}

describe('WorkspaceDownloadsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAnalysisStore.setState({ tasks: [] });
    mocks.startWorkspaceDownload.mockResolvedValue({
      data: { metadata: { task_id: 'task-1' } },
    });
    mocks.downloadWorkspaceArtifact.mockResolvedValue({ data: new Blob(['zip']) });
    mocks.saveBlob.mockResolvedValue(undefined);
  });

  it('completes a workspace download after the Data Loader consumer unmounts', async () => {
    let finishSave: (() => void) | undefined;
    mocks.saveBlob.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const view = render(
      <WorkspaceDownloadsProvider>
        <DownloadStarter />
      </WorkspaceDownloadsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start download' }));
    await waitFor(() => {
      expect(mocks.startWorkspaceDownload).toHaveBeenCalledTimes(1);
    });
    expect(mocks.startWorkspaceDownload).toHaveBeenCalledWith({
      path: { workspace_id: 'workspace-1' },
      throwOnError: true,
    });

    view.rerender(
      <WorkspaceDownloadsProvider>
        <div>Another view</div>
      </WorkspaceDownloadsProvider>,
    );
    act(() => {
      useAnalysisStore.getState().setTasks([
        {
          task_id: 'task-1',
          workspace_id: 'workspace-2',
          state: 'successful',
        },
      ]);
    });
    expect(mocks.downloadWorkspaceArtifact).not.toHaveBeenCalled();

    act(() => {
      useAnalysisStore.getState().setTasks([
        {
          task_id: 'task-1',
          workspace_id: 'workspace-1',
          state: 'successful',
        },
      ]);
    });

    await waitFor(() => {
      expect(mocks.downloadWorkspaceArtifact).toHaveBeenCalledTimes(1);
    });
    expect(mocks.downloadWorkspaceArtifact).toHaveBeenCalledWith({
      parseAs: 'blob',
      path: { workspace_id: 'workspace-1', task_id: 'task-1' },
      throwOnError: true,
    });
    act(() => {
      useAnalysisStore.getState().setTasks([
        {
          task_id: 'task-1',
          workspace_id: 'workspace-1',
          state: 'successful',
        },
      ]);
    });
    act(() => {
      finishSave?.();
    });

    await waitFor(() => {
      expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    });
    expect(mocks.downloadWorkspaceArtifact).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob).toHaveBeenCalledTimes(1);
    expect(mocks.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'Main_Workspace.zip');
  });

  it.each([
    'failed',
    'cancelled',
  ] as const)('reports a %s task once when the terminal task emission repeats', async (state) => {
    render(
      <WorkspaceDownloadsProvider>
        <DownloadStarter />
      </WorkspaceDownloadsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start download' }));
    await waitFor(() => {
      expect(mocks.startWorkspaceDownload).toHaveBeenCalledTimes(1);
    });

    act(() => {
      useAnalysisStore.getState().setTasks([
        {
          task_id: 'task-1',
          workspace_id: 'workspace-1',
          state,
          message: `${state} by backend`,
        },
      ]);
    });
    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    });
    act(() => {
      useAnalysisStore.getState().setTasks([
        {
          task_id: 'task-1',
          workspace_id: 'workspace-1',
          state,
          message: `${state} by backend`,
        },
      ]);
    });

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    });
    expect(mocks.downloadWorkspaceArtifact).not.toHaveBeenCalled();
    expect(mocks.saveBlob).not.toHaveBeenCalled();
  });
});
