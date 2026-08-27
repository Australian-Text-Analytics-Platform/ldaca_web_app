import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DownloadModule from '@/lib/download';

vi.mock('@/features/guidance/GuidanceContext', () => ({
  useGuidance: () => ({
    reachContextualHint: mocks.reachContextualHint,
    startGuidedTour: vi.fn(),
  }),
}));
vi.mock('@/features/guidance/useProgressiveContextualHints', () => ({
  useProgressiveContextualHints: vi.fn(),
}));

import ExportFeature from '../ExportFeature';

const mocks = vi.hoisted(() => ({
  exportDataBlocks: vi.fn(),
  exportWorkspaceArchive: vi.fn(),
  saveBackendDownload: vi.fn(),
  saveDataBlockDownload: vi.fn(),
  reachContextualHint: vi.fn(),
  useWorkspaceData: vi.fn(),
  useWorkspaceSelection: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/api', () => ({
  exportDataBlocks: mocks.exportDataBlocks,
  exportWorkspaceArchive: mocks.exportWorkspaceArchive,
}));
vi.mock('@/lib/download', async (importOriginal) => {
  const actual = await importOriginal<typeof DownloadModule>();
  return {
    ...actual,
    saveBackendDownload: mocks.saveBackendDownload,
    saveDataBlockDownload: mocks.saveDataBlockDownload,
  };
});
vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));
vi.mock('@/features/workspace/common/hooks/useWorkspaceSelection', () => ({
  useWorkspaceSelection: mocks.useWorkspaceSelection,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/help/HelpIcon', () => ({ default: () => null }));
vi.mock('@/components/help/InfoIcon', () => ({ default: () => null }));

const nodes = [
  { id: 'node-1', name: 'Corpus One', shape: [2, 2] },
  { id: 'node-2', name: 'Corpus Two', shape: [3, 2] },
];

describe('ExportFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
      currentWorkspace: { name: 'Main Workspace' },
      nodes,
    });
    mocks.useWorkspaceSelection.mockReturnValue({ selectedNodeIds: [] });
    mocks.exportDataBlocks.mockResolvedValue({
      data: new Blob(['export']),
      response: new Response(null, {
        headers: { 'Content-Disposition': 'attachment; filename="server-export.csv"' },
      }),
    });
    mocks.exportWorkspaceArchive.mockResolvedValue({ data: new Blob(['zip']) });
    mocks.saveBackendDownload.mockResolvedValue(undefined);
    mocks.saveDataBlockDownload.mockResolvedValue(undefined);
  });

  it('exports one selected Data Block directly in the chosen format', async () => {
    const user = userEvent.setup();
    render(<ExportFeature />);

    await user.click(screen.getByRole('button', { name: 'Add data block' }));
    await user.click(screen.getByRole('button', { name: 'Corpus One' }));
    await user.click(screen.getByRole('combobox', { name: 'Export format' }));
    await user.click(screen.getByRole('option', { name: 'Parquet (.parquet)' }));
    mocks.exportDataBlocks.mockResolvedValueOnce({
      data: new Blob(['parquet']),
      response: new Response(null, {
        headers: { 'Content-Disposition': 'attachment; filename="Corpus_One.parquet"' },
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Export 1 Data Block' }));

    await waitFor(() => expect(mocks.saveDataBlockDownload).toHaveBeenCalledTimes(1));
    expect(mocks.saveDataBlockDownload).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      nodeIds: ['node-1'],
      format: 'parquet',
      filename: 'Corpus_One.parquet',
      loadBrowserDownload: expect.any(Function),
    });
    expect(mocks.reachContextualHint).toHaveBeenCalledWith('export.data-block-success');
  });

  it('adds every remaining Data Block without a selector maximum and downloads one ZIP', async () => {
    const user = userEvent.setup();
    render(<ExportFeature />);

    await user.click(screen.getByRole('button', { name: 'Add All' }));
    expect(screen.getByText('Corpus One')).toBeInTheDocument();
    expect(screen.getByText('Corpus Two')).toBeInTheDocument();
    mocks.exportDataBlocks.mockResolvedValueOnce({
      data: new Blob(['zip']),
      response: new Response(null, {
        headers: {
          'Content-Disposition': 'attachment; filename="Main_Workspace_data_blocks.zip"',
        },
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Export 2 Data Blocks' }));

    await waitFor(() => expect(mocks.saveDataBlockDownload).toHaveBeenCalledTimes(1));
    expect(mocks.saveDataBlockDownload).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      nodeIds: ['node-1', 'node-2'],
      format: 'csv',
      filename: 'Main_Workspace_data_blocks.zip',
      loadBrowserDownload: expect.any(Function),
    });
    expect(screen.getByRole('button', { name: 'Add All' })).toBeDisabled();
  });

  it('keeps complete Workspace archive export as a separate action', async () => {
    render(<ExportFeature />);
    fireEvent.click(screen.getByRole('button', { name: 'Export workspace archive' }));

    await waitFor(() =>
      expect(mocks.saveBackendDownload).toHaveBeenCalledWith(
        '/api/workspaces/workspace-1/archive',
        'Main_Workspace.zip',
        expect.any(Function),
      ),
    );
    expect(mocks.reachContextualHint).toHaveBeenCalledWith('export.workspace-success');
  });
});
