import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataLoaderFeature from '../DataLoaderFeature';

const mockSetCurrentWorkspace = vi.fn();
const mockUpdateWorkspaceDescription = vi.fn();
const mockHandleUploadFile = vi.fn();

type MockWorkspaceState = {
  workspaces: Array<{
    id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
    dataframe_count: number;
  }>;
  currentWorkspaceId: string | null;
  workspaceGraph: { nodes: unknown[] };
};

let mockWorkspaceState: MockWorkspaceState = {
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
    handleUploadFile: mockHandleUploadFile,
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
  const getVisibleMatch = <T extends HTMLElement>(elements: T[]) => {
    return elements.at(-1) ?? elements[0];
  };

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
    mockHandleUploadFile.mockResolvedValue(true);
    mockWorkspaceState = {
      workspaces: [{ id: 'ws-1', name: 'Main Workspace', description: 'Initial workspace description', created_at: '2024-01-01', updated_at: '2024-01-02', dataframe_count: 0 }],
      currentWorkspaceId: 'ws-1',
      workspaceGraph: { nodes: [] },
    };
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
    renderWithProviders(<DataLoaderFeature />);

    const activeWorkspaceCard = getVisibleMatch(screen.getAllByTestId('active-workspace-card'));
    expect(within(activeWorkspaceCard).getByText('Active workspace')).toBeInTheDocument();
    expect(within(activeWorkspaceCard).queryByText('Create workspace')).not.toBeInTheDocument();
    expect(within(activeWorkspaceCard).queryByPlaceholderText('Workspace name')).not.toBeInTheDocument();
    expect(within(activeWorkspaceCard).queryByPlaceholderText('Optional description')).not.toBeInTheDocument();

    const workspaceManagerCard = getVisibleMatch(screen.getAllByTestId('workspace-manager-item-ws-1'));
    expect(workspaceManagerCard).toHaveClass('border-primary');
    expect(workspaceManagerCard).toHaveClass('bg-primary/10');

    expect(within(activeWorkspaceCard).getByPlaceholderText('Enter new name')).toBeInTheDocument();

    const quickUnloadButton = within(workspaceManagerCard).getByText(/^Unload$/i, { selector: 'button' });
    expect(quickUnloadButton).toBeEnabled();

    fireEvent.click(quickUnloadButton);

    expect(mockSetCurrentWorkspace).toHaveBeenCalledWith(null);
  });

  it('shows workspace description details from the manager', () => {
    renderWithProviders(<DataLoaderFeature />);

    const activeWorkspaceCard = getVisibleMatch(screen.getAllByTestId('active-workspace-card'));
    const workspaceManagerCard = getVisibleMatch(screen.getAllByTestId('workspace-manager-item-ws-1'));
    expect(within(activeWorkspaceCard).getByDisplayValue('Initial workspace description')).toBeInTheDocument();

    const workspaceDescriptionButton = within(workspaceManagerCard).getByLabelText(/view workspace description/i);
    fireEvent.pointerDown(workspaceDescriptionButton, { button: 0 });

    expect(screen.getByText('Initial workspace description')).toBeInTheDocument();
  });

  it('shows only the create workspace form when no workspace is loaded', () => {
    mockWorkspaceState = {
      workspaces: [{ id: 'ws-1', name: 'Main Workspace', description: 'Initial workspace description', created_at: '2024-01-01', updated_at: '2024-01-02', dataframe_count: 0 }],
      currentWorkspaceId: null,
      workspaceGraph: { nodes: [] },
    };

    renderWithProviders(<DataLoaderFeature />);

    const createWorkspaceCard = getVisibleMatch(screen.getAllByTestId('create-workspace-card'));
    const createWorkspaceButton = within(createWorkspaceCard).getByRole('button', { name: /create workspace/i });
    expect(within(createWorkspaceCard).queryByText('Active workspace')).not.toBeInTheDocument();
    expect(within(createWorkspaceCard).getAllByText('Create workspace')).toHaveLength(2);
    expect(within(createWorkspaceCard).getByPlaceholderText('Workspace name')).toBeInTheDocument();
    expect(within(createWorkspaceCard).getByPlaceholderText('Optional description')).toBeInTheDocument();
    expect(createWorkspaceButton).toBeInTheDocument();
    expect(within(createWorkspaceCard).queryByPlaceholderText('Enter new name')).not.toBeInTheDocument();
    expect(within(createWorkspaceCard).queryByLabelText('Workspace description')).not.toBeInTheDocument();
  });

  it('allows selecting multiple files from the upload picker', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    const uploadInput = screen.getAllByLabelText(/upload files/i, { selector: 'input' }).at(-1);
    expect(uploadInput).toBeDefined();
    expect(uploadInput).toHaveAttribute('multiple');

    const firstFile = new File(['alpha'], 'first.csv', { type: 'text/csv' });
    const secondFile = new File(['beta'], 'second.csv', { type: 'text/csv' });

    await user.upload(uploadInput!, [firstFile, secondFile]);

    await waitFor(() => expect(mockHandleUploadFile).toHaveBeenCalledTimes(2));
    expect(mockHandleUploadFile).toHaveBeenNthCalledWith(1, firstFile);
    expect(mockHandleUploadFile).toHaveBeenNthCalledWith(2, secondFile);
  });

  it('uploads multiple dropped files from the files area', async () => {
    renderWithProviders(<DataLoaderFeature />);

    const uploadArea = screen.getAllByRole('region', { name: /files upload area/i }).at(-1);
    expect(uploadArea).toBeDefined();
    const firstFile = new File(['alpha'], 'dragged-a.csv', { type: 'text/csv' });
    const secondFile = new File(['beta'], 'dragged-b.csv', { type: 'text/csv' });

    fireEvent.dragOver(uploadArea!, {
      dataTransfer: {
        files: [firstFile, secondFile],
        types: ['Files'],
      },
    });

    fireEvent.drop(uploadArea!, {
      dataTransfer: {
        files: [firstFile, secondFile],
        types: ['Files'],
      },
    });

    await waitFor(() => expect(mockHandleUploadFile).toHaveBeenCalledTimes(2));
    expect(mockHandleUploadFile).toHaveBeenNthCalledWith(1, firstFile);
    expect(mockHandleUploadFile).toHaveBeenNthCalledWith(2, secondFile);
  });
});
