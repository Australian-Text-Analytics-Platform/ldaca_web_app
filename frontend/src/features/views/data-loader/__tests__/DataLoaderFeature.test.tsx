import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DataLoaderFeature from '../DataLoaderFeature';
import { listFeaturedDataPortalCollections } from '@/api';
import { WorkspaceDownloadsProvider } from '@/features/workspace/workspace-downloads/WorkspaceDownloadsProvider';

const {
  mockSetCurrentWorkspace,
  mockUpdateWorkspaceDescription,
  mockHandleUploadFile,
  mockHandleDeleteFile,
  mockRawFile,
  mockCreateFolder,
  mockMoveFile,
  mockListFeaturedDataPortalCollections,
  mockRequestContextualHint,
} = vi.hoisted(() => ({
  mockSetCurrentWorkspace: vi.fn(),
  mockUpdateWorkspaceDescription: vi.fn(),
  mockHandleUploadFile: vi.fn(),
  mockHandleDeleteFile: vi.fn(),
  mockRawFile: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockMoveFile: vi.fn(),
  mockListFeaturedDataPortalCollections: vi.fn(),
  mockRequestContextualHint: vi.fn(),
}));

interface MockWorkspaceState {
  workspaces: {
    id: string;
    name: string;
    description: string;
    created_at: string;
    modified_at: string;
    total_nodes: number;
  }[];
  currentWorkspaceId: string | null;
  workspaceGraph: { nodes: unknown[] };
}

let mockWorkspaceState: MockWorkspaceState = {
  workspaces: [
    {
      id: 'ws-1',
      name: 'Main Workspace',
      description: 'Initial workspace description',
      created_at: '2024-01-01',
      modified_at: '2024-01-02',
      total_nodes: 0,
    },
  ],
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

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  // Supplies a mutable workspace fixture so each test can exercise loaded and
  // unloaded Data Loader states without mounting the real workspace provider.
  useWorkspaceData: () => mockWorkspaceState,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  // Exposes only the workspace actions that this feature test asserts, while
  // keeping unrelated mutations inert.
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

vi.mock('@/features/workspace/common/hooks/useWorkspaceStatus', () => ({
  // Keeps workspace cards out of loading state so tests can target controls.
  useWorkspaceStatus: () => ({
    isLoading: { workspaces: false, currentWorkspace: false },
  }),
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  // Provides the auth surface needed by file-browser controls.
  useAuth: () => ({}),
}));

vi.mock('@/features/guidance/GuidanceContext', () => ({
  useGuidance: () => ({
    requestContextualHint: mockRequestContextualHint,
    startGuidedTour: vi.fn(),
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

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getRawFile: mockRawFile,
  createFolder: mockCreateFolder,
  moveFile: mockMoveFile,
  importSampleData: vi.fn(),
  listFeaturedDataPortalCollections: mockListFeaturedDataPortalCollections,
}));

vi.mock('@/features/views/data-loader/hooks/useFiles', () => ({
  // Supplies a stable file tree with README citation coverage for the Data
  // Loader browser tests.
  useFiles: () => ({
    fileTree: mockFileTree,
    selectedFile: null,
    setSelectedFile: vi.fn(),
    loadingFiles: false,
    loading: false,
    uploading: false,
    handleUploadFile: mockHandleUploadFile,
    handleDeleteFile: mockHandleDeleteFile,
    handleDownloadFile: vi.fn(),
    refreshFiles: vi.fn(),
  }),
}));

vi.mock('@/features/views/data-loader/components', () => ({
  // The panel internals are covered elsewhere; this suite only needs Data
  // Loader wiring and file/workspace controls.
  AddFilePanel: () => null,
  /**
   * Keeps preview rendering inert while preserving the feature prop contract.
   */
  FilePreviewPanel: () => null,
}));

vi.mock('@/components/help/HelpIcon', () => ({
  /**
   * Replaces help chrome so tests focus on Data Loader behavior.
   */
  default: () => null,
}));

vi.mock('@/components/help/InfoIcon', () => ({
  /**
   * Replaces info chrome so tests focus on Data Loader behavior.
   */
  default: () => null,
}));

describe('DataLoaderFeature citation UI', () => {
  /**
   * Selects the visible duplicate when responsive/mobile markup leaves more
   * than one matching control in the test DOM.
   */
  const getVisibleMatch = <T extends HTMLElement>(elements: T[]) => {
    return elements.at(-1) ?? elements[0]!;
  };

  /**
   * Mounts DataLoaderFeature with a QueryClient because sample/LDaCA dialogs use
   * TanStack Query even in focused feature tests.
   */
  const renderWithProviders = (ui: React.ReactElement) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceDownloadsProvider>{ui}</WorkspaceDownloadsProvider>
      </QueryClientProvider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHandleUploadFile.mockResolvedValue(true);
    mockRawFile.mockResolvedValue({ data: '# ADO Citation\n\nReference text.', error: undefined });
    mockCreateFolder.mockResolvedValue({
      data: { message: 'Folder created', path: 'new-folder' },
      error: undefined,
    });
    mockMoveFile.mockResolvedValue({
      data: { message: 'File moved', path: 'sample_data/Other/docs.csv' },
      error: undefined,
    });
    mockListFeaturedDataPortalCollections.mockResolvedValue({
      data: { items: [], page: 1, page_size: 20, total: 0 },
      error: undefined,
    });
    mockWorkspaceState = {
      workspaces: [
        {
          id: 'ws-1',
          name: 'Main Workspace',
          description: 'Initial workspace description',
          created_at: '2024-01-01',
          modified_at: '2024-01-02',
          total_nodes: 0,
        },
      ],
      currentWorkspaceId: 'ws-1',
      workspaceGraph: { nodes: [] },
    };
  });

  it('keeps a stable file-list toolbar fallback for contextual guidance', () => {
    renderWithProviders(<DataLoaderFeature />);

    expect(screen.getByRole('toolbar', { name: 'File list' })).toHaveAttribute(
      'data-guidance',
      'file-library-toolbar',
    );
    expect(screen.getByRole('region', { name: 'Files upload area' })).not.toHaveAttribute(
      'data-guidance',
    );
  });

  it('shows folder citation icons only for directories with readme and opens citation dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    const citationButtons = screen.getAllByLabelText(/view citation/i);
    expect(citationButtons).toHaveLength(1);
    expect(screen.queryByText('README.md')).not.toBeInTheDocument();

    await user.click(citationButtons[0]!);

    await waitFor(() => {
      expect(mockRawFile).toHaveBeenCalledWith({
        parseAs: 'text',
        query: { path: 'sample_data/ADO/README.md' },
        throwOnError: true,
      });
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
      expect(mockCreateFolder).toHaveBeenCalledWith({
        body: { name: 'Research Notes', parent_path: '' },
        throwOnError: true,
      });
    });
  });

  it('clears the folder-name draft when the create-folder dialog closes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    fireEvent.click(getVisibleMatch(screen.getAllByRole('button', { name: /add root folder/i })));
    await user.type(screen.getByLabelText(/folder name/i), 'Draft Folder');
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(getVisibleMatch(screen.getAllByRole('button', { name: /add root folder/i })));

    expect(screen.getByLabelText(/folder name/i)).toHaveValue('');
  });

  it('creates a subfolder from a directory row action', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);

    fireEvent.click(
      getVisibleMatch(screen.getAllByRole('button', { name: /add folder inside ado/i })),
    );
    await user.type(screen.getByLabelText(/folder name/i), 'Transcripts');
    fireEvent.click(screen.getByRole('button', { name: /^create folder$/i }));

    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith({
        body: { name: 'Transcripts', parent_path: 'sample_data/ADO' },
        throwOnError: true,
      });
    });
  });

  it('deletes a folder when clicking its trash button', () => {
    renderWithProviders(<DataLoaderFeature />);

    fireEvent.click(getVisibleMatch(screen.getAllByRole('button', { name: /delete folder ado/i })));

    expect(mockHandleDeleteFile).toHaveBeenCalledWith('sample_data/ADO');
  });

  it('persists folder collapsed state in localStorage', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const storageKey = 'ldaca-wordflow-collapsed-folders-v2:__anonymous__:ws-1';
    localStorage.setItem(storageKey, JSON.stringify(['sample_data/Other']));

    renderWithProviders(<DataLoaderFeature />);

    // Target folder ADO trigger click
    const toggleFolderAdo = screen.getByRole('button', { name: /^ADO$/i });
    fireEvent.click(toggleFolderAdo);

    expect(setItemSpy).toHaveBeenCalledWith(storageKey, expect.stringContaining('sample_data/ADO'));

    // Toggle back to open
    fireEvent.click(toggleFolderAdo);
    expect(setItemSpy).toHaveBeenLastCalledWith(storageKey, JSON.stringify(['sample_data/Other']));

    setItemSpy.mockRestore();
    localStorage.clear();
  });

  it('moves a dragged file when dropped on a folder row', async () => {
    renderWithProviders(<DataLoaderFeature />);

    const draggedFileRow = getVisibleMatch(
      screen.getAllByTestId('file-row-sample_data/ADO/docs.csv'),
    );
    const targetFolderRow = getVisibleMatch(screen.getAllByTestId('folder-row-sample_data/Other'));
    let currentDragPath = 'sample_data/ADO/docs.csv';

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn(),
      getData: vi.fn((type: string) =>
        type === 'application/x-ldaca-file-path' ? currentDragPath : '',
      ),
      types: ['application/x-ldaca-file-path', 'text/plain'],
    };

    fireEvent.dragStart(draggedFileRow, { dataTransfer });
    currentDragPath = '';
    fireEvent.dragOver(targetFolderRow, { dataTransfer });

    fireEvent.drop(targetFolderRow, { dataTransfer });

    await waitFor(() => {
      expect(mockMoveFile).toHaveBeenCalledWith({
        body: {
          source_path: 'sample_data/ADO/docs.csv',
          target_directory_path: 'sample_data/Other',
        },
        throwOnError: true,
      });
    });
  });

  it('moves a dragged file when dropped on a file row inside a folder', async () => {
    renderWithProviders(<DataLoaderFeature />);

    const draggedFileRow = getVisibleMatch(
      screen.getAllByTestId('file-row-sample_data/ADO/docs.csv'),
    );
    const targetFileRow = getVisibleMatch(
      screen.getAllByTestId('file-row-sample_data/Other/no-readme.csv'),
    );
    let currentDragPath = 'sample_data/ADO/docs.csv';

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: vi.fn(),
      getData: vi.fn((type: string) =>
        type === 'application/x-ldaca-file-path' ? currentDragPath : '',
      ),
      types: ['application/x-ldaca-file-path', 'text/plain'],
    };

    fireEvent.dragStart(draggedFileRow, { dataTransfer });
    currentDragPath = '';
    fireEvent.dragOver(targetFileRow, { dataTransfer });

    fireEvent.drop(targetFileRow, { dataTransfer });

    await waitFor(() => {
      expect(mockMoveFile).toHaveBeenCalledWith({
        body: {
          source_path: 'sample_data/ADO/docs.csv',
          target_directory_path: 'sample_data/Other',
        },
        throwOnError: true,
      });
    });
  });

  it('renders workspace upload and download controls', () => {
    renderWithProviders(<DataLoaderFeature />);

    expect(screen.getAllByRole('button', { name: /upload workspace/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /download/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('0 data blocks').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /save as/i })).not.toBeInTheDocument();
  });

  it('links LDaCA collection card titles to their portal pages', async () => {
    const user = userEvent.setup();
    vi.mocked(listFeaturedDataPortalCollections).mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'arcp://name,hdl10.26180~23961609',
            crate_id: 'arcp://name,hdl10.26180~23961609',
            title: 'A COrpus of Oz Early English (COOEE)',
            description: 'Historical English corpus',
            types: ['Dataset'],
            license: 'https://creativecommons.org/licenses/by/4.0/',
            importable: true,
            collections: [],
            file_formats: [],
            stats: {},
          },
        ],
        page: 1,
        page_size: 20,
        total: 1,
      },
      error: undefined,
    });

    renderWithProviders(<DataLoaderFeature />);

    await user.click(screen.getByRole('button', { name: /^import from ldaca$/i }));

    const titleLink = await screen.findByRole('link', {
      name: 'A COrpus of Oz Early English (COOEE)',
    });
    expect(titleLink).toHaveAttribute(
      'href',
      'https://data.ldaca.edu.au/collection?id=arcp%3A%2F%2Fname%2Chdl10.26180~23961609&_crateId=arcp%3A%2F%2Fname%2Chdl10.26180~23961609',
    );
    expect(titleLink).toHaveAttribute('target', '_blank');
  });

  it('shows only active workspace controls when a workspace is loaded and allows quick unload from the manager', () => {
    renderWithProviders(<DataLoaderFeature />);

    const activeWorkspaceCard = getVisibleMatch(screen.getAllByTestId('active-workspace-card'));
    expect(within(activeWorkspaceCard).getByText('Active workspace')).toBeInTheDocument();
    expect(within(activeWorkspaceCard).queryByText('Create workspace')).not.toBeInTheDocument();
    expect(
      within(activeWorkspaceCard).queryByPlaceholderText('Workspace name'),
    ).not.toBeInTheDocument();
    expect(
      within(activeWorkspaceCard).queryByPlaceholderText('Optional description'),
    ).not.toBeInTheDocument();

    const workspaceManagerCard = getVisibleMatch(
      screen.getAllByTestId('workspace-manager-item-ws-1'),
    );

    expect(within(activeWorkspaceCard).getByPlaceholderText('Enter new name')).toBeInTheDocument();

    const quickUnloadButton = within(workspaceManagerCard).getByText(/^Unload$/i, {
      selector: 'button',
    });
    expect(quickUnloadButton).toBeEnabled();

    fireEvent.click(quickUnloadButton);

    expect(mockSetCurrentWorkspace).toHaveBeenCalledWith(null);
  });

  it('shows workspace description details from the manager', () => {
    renderWithProviders(<DataLoaderFeature />);

    const activeWorkspaceCard = getVisibleMatch(screen.getAllByTestId('active-workspace-card'));
    const workspaceManagerCard = getVisibleMatch(
      screen.getAllByTestId('workspace-manager-item-ws-1'),
    );
    expect(
      within(activeWorkspaceCard).getByDisplayValue('Initial workspace description'),
    ).toBeInTheDocument();

    const workspaceDescriptionButton = within(workspaceManagerCard).getByLabelText(
      /view workspace description/i,
    );
    fireEvent.pointerDown(workspaceDescriptionButton, { button: 0 });

    expect(screen.getByText('Initial workspace description')).toBeInTheDocument();
  });

  it('shows only the create workspace form when no workspace is loaded', () => {
    mockWorkspaceState = {
      workspaces: [
        {
          id: 'ws-1',
          name: 'Main Workspace',
          description: 'Initial workspace description',
          created_at: '2024-01-01',
          modified_at: '2024-01-02',
          total_nodes: 0,
        },
      ],
      currentWorkspaceId: null,
      workspaceGraph: { nodes: [] },
    };

    renderWithProviders(<DataLoaderFeature />);

    const createWorkspaceCard = getVisibleMatch(screen.getAllByTestId('create-workspace-card'));
    const createWorkspaceButton = within(createWorkspaceCard).getByRole('button', {
      name: /create workspace/i,
    });
    expect(within(createWorkspaceCard).queryByText('Active workspace')).not.toBeInTheDocument();
    expect(within(createWorkspaceCard).getAllByText('Create workspace')).toHaveLength(2);
    expect(within(createWorkspaceCard).getByPlaceholderText('Workspace name')).toBeInTheDocument();
    expect(
      within(createWorkspaceCard).getByPlaceholderText('Optional description'),
    ).toBeInTheDocument();
    expect(createWorkspaceButton).toBeInTheDocument();
    expect(
      within(createWorkspaceCard).queryByPlaceholderText('Enter new name'),
    ).not.toBeInTheDocument();
    expect(
      within(createWorkspaceCard).queryByLabelText('Workspace description'),
    ).not.toBeInTheDocument();
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

    await waitFor(() => {
      expect(mockHandleUploadFile).toHaveBeenCalledTimes(2);
    });
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

    await waitFor(() => {
      expect(mockHandleUploadFile).toHaveBeenCalledTimes(2);
    });
    expect(mockHandleUploadFile).toHaveBeenNthCalledWith(1, firstFile);
    expect(mockHandleUploadFile).toHaveBeenNthCalledWith(2, secondFile);
  });
});
