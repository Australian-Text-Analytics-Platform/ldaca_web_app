import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ExportFeature from '../ExportFeature';

const mocks = vi.hoisted(() => ({
  exportWorkspaceArchive: vi.fn(),
  saveBlob: vi.fn(),
  useWorkspaceData: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/api', () => ({ exportWorkspaceArchive: mocks.exportWorkspaceArchive }));
vi.mock('@/lib/download', () => ({ saveBlob: mocks.saveBlob }));
vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/help/HelpIcon', () => ({ default: () => null }));
vi.mock('@/components/help/InfoIcon', () => ({ default: () => null }));

describe('ExportFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      currentWorkspace: { name: 'Main Workspace' },
    });
    mocks.exportWorkspaceArchive.mockResolvedValue({ data: new Blob(['zip']) });
    mocks.saveBlob.mockResolvedValue(undefined);
  });

  it('exports the complete workspace through the canonical archive endpoint', async () => {
    render(<ExportFeature />);
    fireEvent.click(screen.getByRole('button', { name: 'Export workspace archive' }));

    await waitFor(() => expect(mocks.exportWorkspaceArchive).toHaveBeenCalledTimes(1));
    expect(mocks.exportWorkspaceArchive).toHaveBeenCalledWith({
      parseAs: 'blob',
      path: { workspace_id: 'workspace-1' },
      throwOnError: true,
    });
    await waitFor(() =>
      expect(mocks.saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'Main_Workspace.zip'),
    );
  });
});
