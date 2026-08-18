import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listFeaturedDataPortalCollections } from '@/api';
import { WorkspaceDownloadsProvider } from '@/features/workspace/workspace-downloads/WorkspaceDownloadsProvider';
import type { FileTreeNode } from '@/features/views/data-loader/types';
import DataLoaderFeature from '../DataLoaderFeature';

const {
  mockCreateWorkspace,
  mockSetCurrentWorkspace,
  mockDeleteWorkspace,
  mockUpdateWorkspaceDescription,
  mockUploadFileAtPath,
  mockCreateUploadDirectory,
  mockGetUploadResource,
  mockRefreshFiles,
  mockHandleDeleteFile,
  mockRawFile,
  mockCreateFolder,
  mockMoveFile,
  mockListFeaturedDataPortalCollections,
  mockPublishContextualHints,
  mockToast,
} = vi.hoisted(() => ({
  mockCreateWorkspace: vi.fn(),
  mockSetCurrentWorkspace: vi.fn(),
  mockDeleteWorkspace: vi.fn(),
  mockUpdateWorkspaceDescription: vi.fn(),
  mockUploadFileAtPath: vi.fn(),
  mockCreateUploadDirectory: vi.fn(),
  mockGetUploadResource: vi.fn(),
  mockRefreshFiles: vi.fn(),
  mockHandleDeleteFile: vi.fn(),
  mockRawFile: vi.fn(),
  mockCreateFolder: vi.fn(),
  mockMoveFile: vi.fn(),
  mockListFeaturedDataPortalCollections: vi.fn(),
  mockPublishContextualHints: vi.fn(),
  mockToast: vi.fn(),
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
  workspaceCatalogue?: (
    | MockWorkspaceState['workspaces'][number]
    | {
        availability: 'unavailable';
        id: string;
        reason: 'incompatible_format' | 'corrupt_snapshot' | 'configured_limit';
        message: string;
        name?: string | null;
        description?: string | null;
        created_at?: string | null;
        modified_at?: string | null;
        stored_schema_version?: number | null;
        supported_schema_version?: number | null;
      }
  )[];
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
  toast: Object.assign(mockToast, {
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn((promise: Promise<unknown>) => promise),
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  // Supplies a mutable workspace fixture so each test can exercise loaded and
  // unloaded Data Loader states without mounting the real workspace provider.
  useWorkspaceData: () => ({
    ...mockWorkspaceState,
    workspaceCatalogue: mockWorkspaceState.workspaceCatalogue ?? mockWorkspaceState.workspaces,
  }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  // Exposes only the workspace actions that this feature test asserts, while
  // keeping unrelated mutations inert.
  useWorkspaceActions: () => ({
    createWorkspace: mockCreateWorkspace,
    renameWorkspace: vi.fn(),
    updateWorkspaceDescription: mockUpdateWorkspaceDescription,
    saveWorkspace: vi.fn(),
    deleteWorkspace: mockDeleteWorkspace,
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

vi.mock('@/features/guidance/useProgressiveContextualHints', () => ({
  useProgressiveContextualHints: mockPublishContextualHints,
}));

const defaultMockFileTree: FileTreeNode[] = [
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
let mockFileTree = defaultMockFileTree;

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
    completeFileTree: mockFileTree,
    uploadFileAtPath: mockUploadFileAtPath,
    createUploadDirectory: mockCreateUploadDirectory,
    getUploadResource: mockGetUploadResource,
    handleDeleteFile: mockHandleDeleteFile,
    handleDownloadFile: vi.fn(),
    refreshFiles: mockRefreshFiles,
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
    mockFileTree = defaultMockFileTree;
    mockCreateWorkspace.mockResolvedValue({ id: 'ws-new' });
    mockDeleteWorkspace.mockResolvedValue(undefined);
    mockUploadFileAtPath.mockResolvedValue(undefined);
    mockCreateUploadDirectory.mockResolvedValue(undefined);
    mockGetUploadResource.mockResolvedValue({ type: 'directory', path: 'existing' });
    mockRefreshFiles.mockImplementation(async () => mockFileTree);
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

  it('renders preserved empty directories while counting only loadable files', () => {
    mockFileTree = [
      {
        name: 'figures',
        path: 'figures',
        type: 'directory',
        children: [],
      },
    ];

    renderWithProviders(<DataLoaderFeature />);

    expect(screen.getByRole('button', { name: 'figures' })).toBeInTheDocument();
    expect(within(screen.getByTestId('folder-row-figures')).getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Total files: 0')).toBeInTheDocument();
    expect(
      screen.queryByText('No files found. Upload a dataset to begin.'),
    ).not.toBeInTheDocument();
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

  it('deletes a folder only after confirmation', () => {
    renderWithProviders(<DataLoaderFeature />);

    fireEvent.click(getVisibleMatch(screen.getAllByRole('button', { name: /delete folder ado/i })));

    expect(mockHandleDeleteFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^delete folder$/i }));

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

  it('renders unavailable workspace metadata and keeps archive download available', async () => {
    const user = userEvent.setup();
    const unavailableId = '0a120442-2f33-4474-9d09-9adbdfea7ebc';
    mockWorkspaceState.workspaceCatalogue = [
      {
        availability: 'unavailable',
        id: unavailableId,
        reason: 'incompatible_format',
        message: 'Workspace format 14 is incompatible with supported format 15.',
        name: 'Archived workshop workspace',
        description: 'Workspace from the winter workshop.',
        created_at: '2024-01-01T00:00:00Z',
        modified_at: '2024-01-02T00:00:00Z',
        stored_schema_version: 14,
        supported_schema_version: 15,
      },
      ...mockWorkspaceState.workspaces,
    ];

    renderWithProviders(<DataLoaderFeature />);

    const cards = screen.getAllByTestId(/^workspace-manager-item-/);
    expect(cards.at(-1)).toHaveAttribute('data-testid', `workspace-manager-item-${unavailableId}`);
    const unavailable = within(cards.at(-1)!);
    expect(unavailable.getByText('Archived workshop workspace')).toBeInTheDocument();
    expect(unavailable.getByText(unavailableId)).toBeInTheDocument();
    expect(unavailable.queryByText('Workspace from the winter workshop.')).not.toBeInTheDocument();
    expect(unavailable.getByText(/Created/)).toBeInTheDocument();
    expect(
      unavailable.getByText('Workspace format 14 is incompatible with supported format 15.'),
    ).toBeInTheDocument();
    expect(unavailable.queryByRole('button', { name: 'Load' })).not.toBeInTheDocument();
    expect(unavailable.getByRole('button', { name: 'Download archive' })).toBeEnabled();
    expect(unavailable.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(unavailable.queryByLabelText(/favorites/i)).not.toBeInTheDocument();
    const descriptionButton = unavailable.getByRole('button', {
      name: 'View workspace description',
    });
    fireEvent.pointerDown(descriptionButton, { button: 0 });
    expect(screen.getByText('Workspace from the winter workshop.')).toBeInTheDocument();

    await user.click(unavailable.getByRole('button', { name: 'Delete' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Delete workspace?' });
    expect(confirmation).toHaveTextContent(unavailableId);
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(mockDeleteWorkspace).not.toHaveBeenCalled();
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

  it('keeps each workspace load failure visible until that workspace loads successfully', async () => {
    const user = userEvent.setup();
    mockWorkspaceState = {
      workspaces: [
        {
          id: 'ws-corrupt',
          name: 'Corrupt Workspace',
          description: '',
          created_at: '2024-01-01',
          modified_at: '2024-01-02',
          total_nodes: 2,
        },
        {
          id: 'ws-offline',
          name: 'Remote Workspace',
          description: '',
          created_at: '2024-01-01',
          modified_at: '2024-01-02',
          total_nodes: 1,
        },
      ],
      currentWorkspaceId: null,
      workspaceGraph: { nodes: [] },
    };
    mockSetCurrentWorkspace
      .mockRejectedValueOnce(new Error('Workspace snapshot is corrupt.'))
      .mockRejectedValueOnce(new Error('Unable to reach the backend.'))
      .mockResolvedValueOnce(undefined);

    renderWithProviders(<DataLoaderFeature />);

    const corruptWorkspace = getVisibleMatch(
      screen.getAllByTestId('workspace-manager-item-ws-corrupt'),
    );
    const offlineWorkspace = getVisibleMatch(
      screen.getAllByTestId('workspace-manager-item-ws-offline'),
    );

    await user.click(within(corruptWorkspace).getByRole('button', { name: 'Load' }));
    expect(await within(corruptWorkspace).findByRole('alert')).toHaveTextContent(
      'Failed to load: Workspace snapshot is corrupt.',
    );

    await user.click(within(offlineWorkspace).getByRole('button', { name: 'Load' }));
    expect(await within(offlineWorkspace).findByRole('alert')).toHaveTextContent(
      'Failed to load: Unable to reach the backend.',
    );
    expect(within(corruptWorkspace).getByRole('alert')).toBeInTheDocument();

    await user.click(within(corruptWorkspace).getByRole('button', { name: 'Load' }));
    await waitFor(() => {
      expect(within(corruptWorkspace).queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(within(offlineWorkspace).getByRole('alert')).toBeInTheDocument();
  });

  it('serializes pending Load controls and shows the target loading state', async () => {
    const user = userEvent.setup();
    let finishLoad: () => void = () => undefined;
    mockWorkspaceState = {
      workspaces: [
        ...mockWorkspaceState.workspaces,
        {
          id: 'ws-2',
          name: 'Second Workspace',
          description: '',
          created_at: '2024-01-01',
          modified_at: '2024-01-03',
          total_nodes: 0,
        },
      ],
      currentWorkspaceId: null,
      workspaceGraph: { nodes: [] },
    };
    mockSetCurrentWorkspace.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );

    renderWithProviders(<DataLoaderFeature />);

    const workspace = getVisibleMatch(screen.getAllByTestId('workspace-manager-item-ws-1'));
    const other = getVisibleMatch(screen.getAllByTestId('workspace-manager-item-ws-2'));
    await user.click(within(workspace).getByRole('button', { name: 'Load' }));

    expect(within(workspace).getByRole('button', { name: 'Loading…' })).toBeDisabled();
    expect(within(other).getByRole('button', { name: 'Load' })).toBeDisabled();
    await user.click(within(other).getByRole('button', { name: 'Load' }));
    expect(mockSetCurrentWorkspace).toHaveBeenCalledTimes(1);

    finishLoad();

    await waitFor(() => {
      expect(within(other).getByRole('button', { name: 'Load' })).toBeEnabled();
    });
  });

  it('serializes pending Unload controls and shows Unloading on the active Workspace', async () => {
    const user = userEvent.setup();
    let finishUnload: () => void = () => undefined;
    mockSetCurrentWorkspace.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishUnload = resolve;
        }),
    );

    renderWithProviders(<DataLoaderFeature />);

    const activeCard = getVisibleMatch(screen.getAllByTestId('active-workspace-card'));
    await user.click(within(activeCard).getByRole('button', { name: 'Unload' }));

    expect(within(activeCard).getByRole('button', { name: 'Unloading…' })).toBeDisabled();
    const manager = getVisibleMatch(screen.getAllByTestId('workspace-manager-item-ws-1'));
    expect(within(manager).getByRole('button', { name: 'Unloading…' })).toBeDisabled();
    expect(mockSetCurrentWorkspace).toHaveBeenCalledTimes(1);

    finishUnload();
    await waitFor(() => {
      expect(within(activeCard).getByRole('button', { name: 'Unload' })).toBeEnabled();
    });
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

  it('creates and loads a workspace when no workspace is active', async () => {
    const user = userEvent.setup();
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

    await user.type(
      within(createWorkspaceCard).getByPlaceholderText('Workspace name'),
      'New Workspace',
    );
    await user.click(
      within(createWorkspaceCard).getByRole('button', {
        name: /create workspace/i,
      }),
    );

    await waitFor(() => {
      expect(mockCreateWorkspace).toHaveBeenCalledWith('New Workspace', undefined);
      expect(mockSetCurrentWorkspace).toHaveBeenCalledWith('ws-new');
    });
  });

  it('shows automatic post-create Load failures on the created Workspace card', async () => {
    const user = userEvent.setup();
    mockWorkspaceState = {
      workspaces: [],
      currentWorkspaceId: null,
      workspaceGraph: { nodes: [] },
    };
    mockCreateWorkspace.mockImplementationOnce(async () => {
      mockWorkspaceState = {
        workspaces: [
          {
            id: 'ws-new',
            name: 'New Workspace',
            description: '',
            created_at: '2024-01-01',
            modified_at: '2024-01-01',
            total_nodes: 0,
          },
        ],
        currentWorkspaceId: null,
        workspaceGraph: { nodes: [] },
      };
      return { id: 'ws-new' };
    });
    mockSetCurrentWorkspace.mockRejectedValueOnce(new Error('Snapshot failed validation.'));

    renderWithProviders(<DataLoaderFeature />);
    const createCard = getVisibleMatch(screen.getAllByTestId('create-workspace-card'));
    await user.type(within(createCard).getByPlaceholderText('Workspace name'), 'New Workspace');
    await user.click(within(createCard).getByRole('button', { name: /create workspace/i }));

    const createdCard = await screen.findByTestId('workspace-manager-item-ws-new');
    expect(await within(createdCard).findByRole('alert')).toHaveTextContent(
      'Failed to load: Snapshot failed validation.',
    );
  });

  it('clears a transient Load failure after deleting its Workspace', async () => {
    const user = userEvent.setup();
    mockWorkspaceState.currentWorkspaceId = null;
    mockSetCurrentWorkspace.mockRejectedValueOnce(new Error('Temporary load error.'));

    renderWithProviders(<DataLoaderFeature />);
    const workspace = getVisibleMatch(screen.getAllByTestId('workspace-manager-item-ws-1'));
    await user.click(within(workspace).getByRole('button', { name: 'Load' }));
    expect(await within(workspace).findByRole('alert')).toBeInTheDocument();

    await user.click(within(workspace).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete workspace' }));

    await waitFor(() => {
      expect(within(workspace).queryByRole('alert')).not.toBeInTheDocument();
    });
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
      expect(mockUploadFileAtPath).toHaveBeenCalledTimes(2);
    });
    expect(mockUploadFileAtPath).toHaveBeenNthCalledWith(1, firstFile, 'first.csv');
    expect(mockUploadFileAtPath).toHaveBeenNthCalledWith(2, secondFile, 'second.csv');
  });

  it('offers a single-folder picker alongside the multi-file picker', () => {
    renderWithProviders(<DataLoaderFeature />);

    const fileInput = screen.getAllByLabelText('Upload files', { selector: 'input' }).at(-1);
    const folderInput = screen.getAllByLabelText('Upload folder', { selector: 'input' }).at(-1);

    expect(fileInput).toHaveAttribute('multiple');
    expect(folderInput).not.toHaveAttribute('multiple');
    expect(folderInput).toHaveAttribute('webkitdirectory');
    expect(screen.getAllByRole('button', { name: 'Upload folder' }).at(-1)).toBeEnabled();
  });

  it('shows every preflight conflict and uploads nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);
    const uploadInput = screen.getAllByLabelText('Upload files', { selector: 'input' }).at(-1)!;
    const firstFile = new File(['old'], 'docs.csv');
    Object.defineProperty(firstFile, 'webkitRelativePath', {
      value: 'sample_data/ADO/docs.csv',
    });
    const secondFile = new File(['old'], 'no-readme.csv');
    Object.defineProperty(secondFile, 'webkitRelativePath', {
      value: 'sample_data/Other/no-readme.csv',
    });

    await user.upload(uploadInput, [firstFile, secondFile]);

    const dialog = await screen.findByRole('dialog', { name: 'Upload conflicts' });
    expect(within(dialog).getByText('sample_data/ADO/docs.csv')).toBeInTheDocument();
    expect(within(dialog).getByText('sample_data/Other/no-readme.csv')).toBeInTheDocument();
    expect(mockUploadFileAtPath).not.toHaveBeenCalled();
    expect(mockCreateUploadDirectory).not.toHaveBeenCalled();
  });

  it('announces upload progress and offers cooperative cancellation', async () => {
    let finishUpload!: () => void;
    mockUploadFileAtPath.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DataLoaderFeature />);
    const uploadInput = screen.getAllByLabelText('Upload files', { selector: 'input' }).at(-1)!;

    await user.upload(uploadInput, new File(['new'], 'new.csv'));

    expect(await screen.findByRole('status')).toHaveTextContent('Uploading file 1 of 1: new.csv');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => finishUpload());
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('guides users to the folder picker when folder drop entries are unavailable', async () => {
    renderWithProviders(<DataLoaderFeature />);
    const uploadArea = screen.getAllByRole('region', { name: /files upload area/i }).at(-1)!;

    fireEvent.drop(uploadArea, {
      dataTransfer: {
        files: [],
        items: [
          {
            kind: 'file',
            getAsFile: () => null,
          },
        ],
        types: ['Files'],
      },
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        'Folder drop is not supported here. Use Upload folder instead.',
        expect.any(Object),
      );
    });
    expect(mockUploadFileAtPath).not.toHaveBeenCalled();
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
      expect(mockUploadFileAtPath).toHaveBeenCalledTimes(2);
    });
    expect(mockUploadFileAtPath).toHaveBeenNthCalledWith(1, firstFile, 'dragged-a.csv');
    expect(mockUploadFileAtPath).toHaveBeenNthCalledWith(2, secondFile, 'dragged-b.csv');
  });
});
