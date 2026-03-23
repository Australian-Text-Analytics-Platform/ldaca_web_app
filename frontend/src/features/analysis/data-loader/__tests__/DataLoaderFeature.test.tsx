import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataLoaderFeature from '../DataLoaderFeature';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn((promise: Promise<unknown>) => promise),
  }),
}));

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({
    workspaces: [{ id: 'ws-1', name: 'Main Workspace', created_at: '2024-01-01', updated_at: '2024-01-02', dataframe_count: 0 }],
    currentWorkspaceId: 'ws-1',
    workspaceGraph: { nodes: [] },
  }),
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    saveWorkspaceAs: vi.fn(),
    deleteWorkspace: vi.fn(),
    setCurrentWorkspace: vi.fn(),
    createNodeFromFile: vi.fn(),
  }),
}));

vi.mock('@/hooks/useWorkspaceStatus', () => ({
  useWorkspaceStatus: () => ({
    isLoading: { workspaces: false, currentWorkspace: false },
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    dataFolder: '/tmp/user_data',
    getAuthHeaders: () => ({}),
  }),
}));

const mockFiles = [
  {
    filename: 'sample_data/ADO/docs.csv',
    display_name: 'docs.csv',
    folder: 'sample_data/ADO',
    size: 100,
    created_at: Date.now(),
    file_type: 'csv',
    readme: '# ADO Citation\n\nReference text.',
  },
  {
    filename: 'sample_data/ADO/README.md',
    display_name: 'README.md',
    folder: 'sample_data/ADO',
    size: 50,
    created_at: Date.now(),
    file_type: 'text',
    readme: null,
  },
  {
    filename: 'sample_data/Other/no-readme.csv',
    display_name: 'no-readme.csv',
    folder: 'sample_data/Other',
    size: 75,
    created_at: Date.now(),
    file_type: 'csv',
    readme: null,
  },
];

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => ({
    files: mockFiles,
    fileListResponse: { files: mockFiles, total: mockFiles.length, user_folder: '/tmp/user_data' },
    selectedFile: null,
    setSelectedFile: vi.fn(),
    loadingFiles: false,
    loading: false,
    uploading: false,
    handleUploadFile: vi.fn(),
    handleDeleteFile: vi.fn(),
    handleDownloadFile: vi.fn(),
    refetchFiles: vi.fn(),
  }),
}));

vi.mock('@/components/panels', () => ({
  AddFilePanel: () => null,
  FilePreviewPanel: () => null,
}));

vi.mock('@/components/help/HelpIcon', () => ({
  default: () => null,
}));

vi.mock('@/api/workspaces', () => ({
  workspacesApi: {
    uploadZip: vi.fn(),
    downloadZip: vi.fn(),
  },
}));

describe('DataLoaderFeature citation UI', () => {
  const renderWithProviders = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows inline citation icon only for files with readme and opens citation dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    const citationButtons = screen.getAllByLabelText(/view citation/i);
    expect(citationButtons).toHaveLength(1);

    await user.click(citationButtons[0]);

    expect(screen.getByRole('heading', { name: 'Citation' })).toBeInTheDocument();
    expect(screen.getByText('ADO Citation')).toBeInTheDocument();
    expect(screen.getByText('Reference text.')).toBeInTheDocument();
  });

  it('renders workspace upload and download controls', () => {
    renderWithProviders(<DataLoaderFeature />);

    expect(screen.getByRole('button', { name: /upload workspace/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /download/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('0 data blocks').length).toBeGreaterThan(0);
  });
});
