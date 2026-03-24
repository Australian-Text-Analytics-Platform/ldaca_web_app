import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataLoaderFeature from '../DataLoaderFeature';

const mockSetCurrentWorkspace = vi.fn();
const mockUpdateWorkspaceDescription = vi.fn();

let mockWorkspaceState = {
  workspaces: [{ id: 'ws-1', name: 'Main Workspace', description: 'Initial workspace description', created_at: '2024-01-01', updated_at: '2024-01-02', dataframe_count: 0 }],
  currentWorkspaceId: 'ws-1',
  workspaceGraph: { nodes: [] },
};

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn((promise: Promise<unknown>) => promise),
  }),
}));

vi.mock('@/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => mockWorkspaceState,
}));

vi.mock('@/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    updateWorkspaceDescription: mockUpdateWorkspaceDescription,
    saveWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    setCurrentWorkspace: mockSetCurrentWorkspace,
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
    mockWorkspaceState = {
      workspaces: [{ id: 'ws-1', name: 'Main Workspace', description: 'Initial workspace description', created_at: '2024-01-01', updated_at: '2024-01-02', dataframe_count: 0 }],
      currentWorkspaceId: 'ws-1',
      workspaceGraph: { nodes: [] },
    };
  });

  afterEach(() => {
    cleanup();
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
    expect(screen.queryByRole('button', { name: /save as/i })).not.toBeInTheDocument();
  });

  it('shows only active workspace controls when a workspace is loaded and allows quick unload from the manager', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    expect(screen.queryByPlaceholderText('Workspace name')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Optional description')).not.toBeInTheDocument();

    const activeWorkspaceHeading = screen.getAllByText('Active workspace')[0];
    const activeWorkspaceCard = activeWorkspaceHeading.closest('div.rounded-xl.border.bg-card');
    expect(activeWorkspaceCard).not.toBeNull();

    const workspaceCardName = screen.getAllByText('Main Workspace')[1];
    const workspaceManagerCard = workspaceCardName.closest('div.rounded-md.border');
    expect(workspaceManagerCard?.className).toContain('border-primary');
    expect(workspaceManagerCard?.className).toContain('bg-primary/10');

    expect(screen.getByPlaceholderText('Enter new name')).toBeInTheDocument();

    const quickUnloadButton = screen.getAllByRole('button', { name: /^Unload$/i }).find((button) => {
      return workspaceManagerCard?.contains(button) ?? false;
    });
    expect(quickUnloadButton).toBeDefined();
    expect(quickUnloadButton).toBeEnabled();

    await user.click(quickUnloadButton!);

    expect(mockSetCurrentWorkspace).toHaveBeenCalledWith(null);
  });

  it('shows workspace description details from the manager and updates the active workspace description', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    expect(screen.getByDisplayValue('Initial workspace description')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view workspace description/i }));

    expect(screen.getByText('Initial workspace description')).toBeInTheDocument();

    const descriptionInput = screen.getByLabelText('Workspace description');
    await user.clear(descriptionInput);
    await user.type(descriptionInput, 'Updated workspace description');
    await user.click(screen.getByRole('button', { name: /update description/i }));

    expect(mockUpdateWorkspaceDescription).toHaveBeenCalledWith('Updated workspace description');
  });

  it('shows only the create workspace form when no workspace is loaded', () => {
    mockWorkspaceState = {
      workspaces: [{ id: 'ws-1', name: 'Main Workspace', description: 'Initial workspace description', created_at: '2024-01-01', updated_at: '2024-01-02', dataframe_count: 0 }],
      currentWorkspaceId: null,
      workspaceGraph: { nodes: [] },
    };

    renderWithProviders(<DataLoaderFeature />);

    expect(screen.getByPlaceholderText('Workspace name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Optional description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter new name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace description')).not.toBeInTheDocument();
  });
});
