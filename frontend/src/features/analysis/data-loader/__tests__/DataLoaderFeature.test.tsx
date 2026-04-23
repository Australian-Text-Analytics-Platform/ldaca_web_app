import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataLoaderFeature from '../DataLoaderFeature';

const {
  mockSetCurrentWorkspace,
  mockUpdateWorkspaceDescription,
  mockHandleUploadFile,
  mockRawFile,
  mockCreateFolder,
  mockMoveFile,
} = vi.hoisted(() => ({
  mockSetCurrentWorkspace: vi.fn(),
  mockUpdateWorkspaceDescription: vi.fn(),
  mockHandleUploadFile: vi.fn(),
  mockRawFile: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockMoveFile: vi.fn(),
}));

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

const mockFileTree = [
  {
    name: 'sample_data',
    path: 'sample_data',
    type: 'directory' as const,
    children: [
      {
        name: 'ADO',
        path: 'sample_data/ADO',
        type: 'directory' as const,
        children: [
          {
            name: 'README.md',
            path: 'sample_data/ADO/README.md',
            type: 'file' as const,
            size: 48,
          },
          {
            name: 'docs.csv',
            path: 'sample_data/ADO/docs.csv',
            type: 'file' as const,
            size: 100,
          },
        ],
      },
      {
        name: 'Other',
        path: 'sample_data/Other',
        type: 'directory' as const,
        children: [
          {
            name: 'no-readme.csv',
            path: 'sample_data/Other/no-readme.csv',
            type: 'file' as const,
            size: 75,
          },
        ],
      },
    ],
  },
];

vi.mock('@/api/files', () => ({
  filesApi: {
    raw: mockRawFile,
    createFolder: mockCreateFolder,
    moveFile: mockMoveFile,
    importSampleData: vi.fn(),
    importLdaca: vi.fn(),
  },
}));

vi.mock('@/hooks/useFiles', () => ({
  useFiles: () => ({
    fileTree: mockFileTree,
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

vi.mock('@/components/help/InfoIcon', () => ({
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
    mockRawFile.mockResolvedValue('# ADO Citation\n\nReference text.');
    mockCreateFolder.mockResolvedValue({ message: 'Folder created', path: 'new-folder' });
    mockMoveFile.mockResolvedValue({ message: 'File moved', path: 'sample_data/Other/docs.csv' });
    mockWorkspaceState = {
      workspaces: [{ id: 'ws-1', name: 'Main Workspace', description: 'Initial workspace description', created_at: '2024-01-01', updated_at: '2024-01-02', dataframe_count: 0 }],
      currentWorkspaceId: 'ws-1',
      workspaceGraph: { nodes: [] },
    };
  });

  it('shows folder citation icons only for directories with readme and opens citation dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    const citationButtons = screen.getAllByLabelText(/view citation/i);
    expect(citationButtons).toHaveLength(1);
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();

    await user.click(citationButtons[0]);

    await waitFor(() => {
      expect(mockRawFile).toHaveBeenCalledWith('sample_data/ADO/README.md', {});
    });
    expect(screen.getByRole('heading', { name: 'Citation' })).toBeInTheDocument();
    expect(screen.getByText('ADO Citation')).toBeInTheDocument();
    expect(screen.getByText('Reference text.')).toBeInTheDocument();
  });

  it('creates a root folder from the top-level add folder button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    fireEvent.click(getVisibleMatch(screen.getAllByRole('button', { name: /add root folder/i })));
    await user.type(screen.getByLabelText(/folder name/i), 'Research Notes');
    fireEvent.click(screen.getByRole('button', { name: /^create folder$/i }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('', 'Research Notes', {});
    });
  });

  it('creates a subfolder from a directory row action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    fireEvent.click(getVisibleMatch(screen.getAllByRole('button', { name: /add folder inside ado/i })));
    await user.type(screen.getByLabelText(/folder name/i), 'Transcripts');
    fireEvent.click(screen.getByRole('button', { name: /^create folder$/i }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith('sample_data/ADO', 'Transcripts', {});
    });
  });

  it('moves a dragged file when dropped on a folder row', async () => {
    renderWithProviders(<DataLoaderFeature />);

    const draggedFileRow = getVisibleMatch(screen.getAllByTestId('file-row-sample_data/ADO/docs.csv'));
    const targetFolderRow = getVisibleMatch(screen.getAllByTestId('folder-row-sample_data/Other'));
    let currentDragPath = 'sample_data/ADO/docs.csv';

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn(),
      getData: vi.fn((type: string) => type === 'application/x-ldaca-file-path' ? currentDragPath : ''),
      types: ['application/x-ldaca-file-path', 'text/plain'],
    };

    fireEvent.dragStart(draggedFileRow, { dataTransfer });
    currentDragPath = '';
    fireEvent.dragOver(targetFolderRow, { dataTransfer });

    await waitFor(() => {
      expect(targetFolderRow.className).toContain('bg-primary/10');
    });

    fireEvent.drop(targetFolderRow, { dataTransfer });

    await waitFor(() => {
      expect(mockMoveFile).toHaveBeenCalledWith('sample_data/ADO/docs.csv', 'sample_data/Other', {});
    });
  });

  it('moves a dragged file when dropped on a file row inside a folder', async () => {
    renderWithProviders(<DataLoaderFeature />);

    const draggedFileRow = getVisibleMatch(screen.getAllByTestId('file-row-sample_data/ADO/docs.csv'));
    const targetFileRow = getVisibleMatch(screen.getAllByTestId('file-row-sample_data/Other/no-readme.csv'));
    let currentDragPath = 'sample_data/ADO/docs.csv';

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn(),
      getData: vi.fn((type: string) => type === 'application/x-ldaca-file-path' ? currentDragPath : ''),
      types: ['application/x-ldaca-file-path', 'text/plain'],
    };

    fireEvent.dragStart(draggedFileRow, { dataTransfer });
    currentDragPath = '';
    fireEvent.dragOver(targetFileRow, { dataTransfer });

    await waitFor(() => {
      expect(targetFileRow.className).toContain('bg-primary/10');
    });

    fireEvent.drop(targetFileRow, { dataTransfer });

    await waitFor(() => {
      expect(mockMoveFile).toHaveBeenCalledWith('sample_data/ADO/docs.csv', 'sample_data/Other', {});
    });
  });

  it('renders workspace upload and download controls', () => {
    renderWithProviders(<DataLoaderFeature />);

    expect(screen.getAllByRole('button', { name: /upload workspace/i }).length).toBeGreaterThan(0);
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
