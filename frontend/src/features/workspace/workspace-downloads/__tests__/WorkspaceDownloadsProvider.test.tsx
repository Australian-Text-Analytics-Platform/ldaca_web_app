import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceDownloadsProvider } from '../WorkspaceDownloadsProvider';
import { useWorkspaceDownloads } from '../WorkspaceDownloadsContext';

const mocks = vi.hoisted(() => ({
  exportWorkspaceArchive: vi.fn(),
  saveBackendDownload: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  exportWorkspaceArchive: mocks.exportWorkspaceArchive,
}));
vi.mock('@/lib/download', () => ({ saveBackendDownload: mocks.saveBackendDownload }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

function DownloadStarter() {
  const downloads = useWorkspaceDownloads();
  return (
    <>
      <button
        type="button"
        onClick={() => void downloads.startDownload('workspace-1', 'Main Workspace')}
      >
        Start download
      </button>
      <output>{downloads.isPending('workspace-1') ? 'pending' : 'idle'}</output>
    </>
  );
}

describe('WorkspaceDownloadsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exportWorkspaceArchive.mockResolvedValue({ data: new Blob(['zip']) });
    mocks.saveBackendDownload.mockResolvedValue(undefined);
  });

  it('downloads the canonical workspace archive and keeps the command shell-owned', async () => {
    render(
      <WorkspaceDownloadsProvider>
        <DownloadStarter />
      </WorkspaceDownloadsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start download' }));
    await waitFor(() =>
      expect(mocks.saveBackendDownload).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/archive',
        'Main_Workspace.zip',
        expect.any(Function),
      ),
    );
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('reports archive failures without leaving a pending marker', async () => {
    mocks.saveBackendDownload.mockRejectedValue(new Error('archive unavailable'));
    render(
      <WorkspaceDownloadsProvider>
        <DownloadStarter />
      </WorkspaceDownloadsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start download' }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith('archive unavailable', { duration: 6000 }),
    );
    expect(screen.getByText('idle')).toBeInTheDocument();
  });
});
