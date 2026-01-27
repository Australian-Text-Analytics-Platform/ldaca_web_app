import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import DataLoaderFeature from '../DataLoaderFeature';

const mockUseWorkspaceData = vi.fn();
const mockUseWorkspaceActions = vi.fn();
const mockUseWorkspaceStatus = vi.fn();
const mockUseAuth = vi.fn();
const mockUseFiles = vi.fn();
type UIStoreState = {
  openTutorialTarget: (target: unknown) => void;
};

const mockUseUIStore = vi.fn<[], UIStoreState>();

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => mockUseWorkspaceData(),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => mockUseWorkspaceActions(),
}));

vi.mock('@/hooks/useWorkspaceStatus', () => ({
  useWorkspaceStatus: () => mockUseWorkspaceStatus(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => mockUseFiles(),
}));

vi.mock('@/stores', () => ({
  useUIStore: <T,>(selector?: (state: UIStoreState) => T) =>
    selector ? selector(mockUseUIStore()) : mockUseUIStore(),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../components/panels', () => ({
  AddFilePanel: () => null,
  FilePreviewPanel: () => null,
}));

beforeEach(() => {
  mockUseWorkspaceData.mockImplementation(() => ({
    workspaces: [
      {
        workspace_id: 'workspace-1',
        name: 'Workspace One',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        dataframe_count: 2,
      },
    ],
    currentWorkspaceId: 'workspace-1',
    workspaceGraph: { nodes: [{ id: 'n1' }, { id: 'n2' }] },
  }));

  mockUseWorkspaceActions.mockImplementation(() => ({
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    saveWorkspaceAs: vi.fn(),
    deleteWorkspace: vi.fn(),
    createNodeFromFile: vi.fn(),
    setCurrentWorkspace: vi.fn(),
  }));

  mockUseWorkspaceStatus.mockImplementation(() => ({
    isLoading: { workspaces: false, currentWorkspace: false },
  }));

  mockUseAuth.mockImplementation(() => ({
    dataFolder: 'data/',
    getAuthHeaders: () => ({}),
  }));

  mockUseFiles.mockImplementation(() => ({
    files: [],
    fileListResponse: null,
    selectedFile: null,
    setSelectedFile: vi.fn(),
    loadingFiles: false,
    loading: false,
    uploading: false,
    handleUploadFile: vi.fn(),
    handleDeleteFile: vi.fn(),
    handleDownloadFile: vi.fn(),
    refetchFiles: vi.fn(),
  }));

  mockUseUIStore.mockImplementation(() => ({
    openTutorialTarget: vi.fn(),
  }));
});

describe('DataLoaderFeature', () => {
  it('renders a help icon for the workspace manager section', () => {
    render(<DataLoaderFeature />);

    expect(
      screen.getByRole('button', { name: /workspace manager overview/i })
    ).toBeInTheDocument();
  });
});