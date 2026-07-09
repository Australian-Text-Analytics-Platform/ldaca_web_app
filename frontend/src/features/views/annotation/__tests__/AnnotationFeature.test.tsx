import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnnotationFeature from '../AnnotationFeature';
import type {
  NodeInputColumnAddonArgs,
  NodeInputsPanelProps,
} from '@/features/views/common/components/NodeInputsPanel';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import type { NodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';
import { usePreferencesStore } from '@/stores/preferencesStore';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

const mocks = vi.hoisted(() => ({
  createAnnotationClassDescriptions: vi.fn(),
  createAnnotationColumn: vi.fn(),
  getAnnotationClassDescriptions: vi.fn(),
  updateAnnotationClassDescriptions: vi.fn(),
  setAnnotationClassParent: vi.fn(),
  setAnnotationCell: vi.fn(),
  getNodeDataByWorkspaceId: vi.fn(),
  annotateAiPreview: vi.fn(),
  annotateAiPreviewState: vi.fn(),
  annotateAiPreviewOverride: vi.fn(),
  annotateAiPreviewClear: vi.fn(),
  detachAiPreviewedRows: vi.fn(),
  annotateAiAll: vi.fn(),
  listAnnotationAiModels: vi.fn(),
  useAuth: vi.fn(),
  useWorkspaceData: vi.fn(),
  useTabNodeInputs: vi.fn(),
  useNodeInputRequestsStore: vi.fn(),
}));

vi.mock('@/api', () => ({
  createAnnotationClassDescriptions: mocks.createAnnotationClassDescriptions,
  createAnnotationColumn: mocks.createAnnotationColumn,
  getAnnotationClassDescriptions: mocks.getAnnotationClassDescriptions,
  updateAnnotationClassDescriptions: mocks.updateAnnotationClassDescriptions,
  setAnnotationClassParent: mocks.setAnnotationClassParent,
  setAnnotationCell: mocks.setAnnotationCell,
  getNodeDataByWorkspaceId: mocks.getNodeDataByWorkspaceId,
  annotateAiPreview: mocks.annotateAiPreview,
  annotateAiPreviewState: mocks.annotateAiPreviewState,
  annotateAiPreviewOverride: mocks.annotateAiPreviewOverride,
  annotateAiPreviewClear: mocks.annotateAiPreviewClear,
  detachAiPreviewedRows: mocks.detachAiPreviewedRows,
  annotateAiAll: mocks.annotateAiAll,
  listAnnotationAiModels: mocks.listAnnotationAiModels,
}));

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: mocks.useAuth,
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: mocks.useWorkspaceData,
}));

vi.mock('@/features/views/common/nodeInputs', () => ({
  useTabNodeInputs: mocks.useTabNodeInputs,
}));

vi.mock('@/stores/nodeInputRequestsStore', () => ({
  useNodeInputRequestsStore: mocks.useNodeInputRequestsStore,
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => {
  return {
    NodeInputsPanel: (props: NodeInputsPanelProps) => {
      const title = props.title ?? 'Selected Data Blocks';
      const firstNode = props.resolvedNodes[0];
      const addonArgs: NodeInputColumnAddonArgs | null = firstNode
        ? {
            node: firstNode.node,
            nodeId: firstNode.id,
            index: 0,
            color: '#2563eb',
            column: firstNode.column,
            columns: firstNode.columnOptions.map((option) => option.name),
          }
        : null;
      return (
        <section aria-label={title}>
          <div>{title}</div>
          {addonArgs ? (
            <div data-testid={`${title}-addon`}>
              <span>
                {typeof props.columnLabel === 'function'
                  ? props.columnLabel(addonArgs)
                  : props.columnLabel}
              </span>
              {props.renderColumnAddon?.(addonArgs)}
              {props.renderExtraNodeContent?.(addonArgs)}
            </div>
          ) : null}
          {props.headerAddon}
        </section>
      );
    },
  };
});

const sourceNodeInputs = (
  overrides: Partial<UseTabNodeInputsResult> = {},
): UseTabNodeInputsResult => ({
  inputs: [{ node_id: 'source-node', column: 'text' }],
  resolvedNodes: [
    {
      id: 'source-node',
      name: 'Source',
      node: {
        id: 'source-node',
        name: 'Source',
        columns: ['text', 'existing_annotation'],
        schema: { text: 'String', existing_annotation: 'String' },
      },
      column: 'text',
      columnOptions: [
        { name: 'text', dataType: 'string' },
        { name: 'existing_annotation', dataType: 'string' },
      ],
    },
  ],
  selectedNodes: [
    {
      id: 'source-node',
      name: 'Source',
      columns: ['text', 'existing_annotation'],
    },
  ],
  nodeColumnSelections: [{ nodeId: 'source-node', column: 'text' }],
  availableNodes: [],
  canAddMore: false,
  addNodes: vi.fn(() => []),
  getAddRejection: vi.fn(() => null),
  removeNode: vi.fn(),
  clear: vi.fn(),
  setColumn: vi.fn(),
  graphSelectedIds: [],
  workspaceId: 'workspace-1',
  recentPresets: [],
  ...overrides,
  nodeInfoCache: overrides.nodeInfoCache ?? {},
  getColumnInfos: overrides.getColumnInfos ?? vi.fn(() => []),
  getNodeInfo: overrides.getNodeInfo ?? vi.fn(() => undefined),
});

const classNodeInputs = (
  overrides: Partial<UseTabNodeInputsResult> = {},
): UseTabNodeInputsResult => ({
  inputs: [{ node_id: 'classes-node', column: 'class' }],
  resolvedNodes: [
    {
      id: 'classes-node',
      name: 'Annotation Classes',
      node: {
        id: 'classes-node',
        name: 'Annotation Classes',
        columns: ['class', 'description'],
        schema: { class: 'String', description: 'String' },
      },
      column: 'class',
      columnOptions: [
        { name: 'class', dataType: 'string' },
        { name: 'description', dataType: 'string' },
      ],
    },
  ],
  selectedNodes: [
    {
      id: 'classes-node',
      name: 'Annotation Classes',
      columns: ['class', 'description'],
    },
  ],
  nodeColumnSelections: [{ nodeId: 'classes-node', column: 'class' }],
  availableNodes: [],
  canAddMore: false,
  addNodes: vi.fn(() => []),
  getAddRejection: vi.fn(() => null),
  removeNode: vi.fn(),
  clear: vi.fn(),
  setColumn: vi.fn(),
  graphSelectedIds: [],
  workspaceId: 'workspace-1',
  recentPresets: [],
  ...overrides,
  nodeInfoCache: overrides.nodeInfoCache ?? {},
  getColumnInfos: overrides.getColumnInfos ?? vi.fn(() => []),
  getNodeInfo: overrides.getNodeInfo ?? vi.fn(() => undefined),
});

// AI-mode example selector. Defaults to one string node so the example
// annotation-column addon can be exercised once AI mode is enabled.
const exampleNodeInputs = (
  overrides: Partial<UseTabNodeInputsResult> = {},
): UseTabNodeInputsResult => ({
  inputs: [{ node_id: 'example-node', column: 'text' }],
  resolvedNodes: [
    {
      id: 'example-node',
      name: 'Example',
      node: {
        id: 'example-node',
        name: 'Example',
        columns: ['text', 'existing_annotation'],
        schema: { text: 'String', existing_annotation: 'String' },
      },
      column: 'text',
      columnOptions: [
        { name: 'text', dataType: 'string' },
        { name: 'existing_annotation', dataType: 'string' },
      ],
    },
  ],
  selectedNodes: [
    {
      id: 'example-node',
      name: 'Example',
      columns: ['text', 'existing_annotation'],
    },
  ],
  nodeColumnSelections: [{ nodeId: 'example-node', column: 'text' }],
  availableNodes: [],
  canAddMore: false,
  addNodes: vi.fn(() => []),
  getAddRejection: vi.fn(() => null),
  removeNode: vi.fn(),
  clear: vi.fn(),
  setColumn: vi.fn(),
  graphSelectedIds: [],
  workspaceId: 'workspace-1',
  recentPresets: [],
  ...overrides,
  nodeInfoCache: overrides.nodeInfoCache ?? {},
  getColumnInfos: overrides.getColumnInfos ?? vi.fn(() => []),
  getNodeInfo: overrides.getNodeInfo ?? vi.fn(() => undefined),
});

function nodeInputRequestsStore(
  overrides: Partial<NodeInputRequestsStore> = {},
): NodeInputRequestsStore {
  const store: NodeInputRequestsStore = {
    nextId: 1,
    requests: [],
    requestAdd: vi.fn(),
    consume: vi.fn(),
    ...overrides,
  };
  mocks.useNodeInputRequestsStore.mockImplementation(
    (selector: (state: NodeInputRequestsStore) => unknown) => selector(store),
  );
  return store;
}

function renderAnnotationFeature(props: Partial<ComponentProps<typeof AnnotationFeature>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onTabInputSetChange = vi.fn();
  return render(
    <QueryClientProvider client={queryClient}>
      <AnnotationFeature
        tabInputs={[{ node_id: 'source-node', column: 'text' }]}
        onTabInputsChange={vi.fn()}
        tabInputSets={{
          source: [{ node_id: 'source-node', column: 'text' }],
          classDescriptions: [{ node_id: 'classes-node', column: 'class' }],
        }}
        onTabInputSetChange={onTabInputSetChange}
        {...props}
      />
    </QueryClientProvider>,
  );
}

function openRouterModelsResponse(modelIds: string[]) {
  return new Response(
    JSON.stringify({
      data: modelIds.map((id) => ({
        id,
        pricing: { prompt: '0.0000007', completion: '0.0000014' },
      })),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('AnnotationFeature', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom may not implement hasPointerCapture despite lib.dom types
    if (!HTMLElement.prototype.hasPointerCapture) {
      Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
        configurable: true,
        value: vi.fn(() => false),
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom may not implement scrollIntoView despite lib.dom types
    if (!HTMLElement.prototype.scrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        value: vi.fn(),
      });
    }
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(openRouterModelsResponse(['openai/gpt-4o', 'gpt-custom']));
    // Reset the (real) preferences store so AI api-keys/custom providers from one
    // test do not leak into the next.
    usePreferencesStore.setState({
      annotationAiApiKeys: {},
      annotationAiCustomProviders: [],
    });
    mocks.useAuth.mockReturnValue({
      getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
    });
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
    });
    nodeInputRequestsStore();
    mocks.useTabNodeInputs.mockImplementation((config: { selectorId?: string }) => {
      if (config.selectorId === 'classDescriptions') return classNodeInputs();
      if (config.selectorId === 'exampleNodes') return exampleNodeInputs();
      return sourceNodeInputs();
    });
    mocks.createAnnotationClassDescriptions.mockResolvedValue({
      data: {
        id: 'new-class-node',
        name: 'Annotation Classes',
        columns: ['class', 'description'],
        schema: { class: 'String', description: 'String' },
      },
    });
    mocks.getAnnotationClassDescriptions.mockResolvedValue({
      data: {
        class_column: 'class',
        description_column: 'description',
        rows: [{ class: 'support', description: 'Supportive stance' }],
      },
    });
    mocks.updateAnnotationClassDescriptions.mockResolvedValue({
      data: {
        class_column: 'class',
        description_column: 'description',
        rows: [{ class: 'critical', description: 'Supportive stance' }],
      },
    });
    mocks.setAnnotationClassParent.mockResolvedValue({ data: { id: 'classes-node' } });
    mocks.setAnnotationCell.mockResolvedValue({ data: { id: 'source-node' } });
    mocks.createAnnotationColumn.mockResolvedValue({
      data: {
        id: 'source-node',
        columns: ['text', 'existing_annotation', 'annotation'],
        schema: { text: 'String', existing_annotation: 'String', annotation: 'String' },
      },
    });
    mocks.getNodeDataByWorkspaceId.mockResolvedValue({
      data: {
        columns: ['text', 'existing_annotation'],
        data: [{ text: 'hello world', existing_annotation: 'support' }],
        dtypes: { text: 'String', existing_annotation: 'String' },
        pagination: { page: 1, page_size: 50, total_rows: 1, total_pages: 1 },
        sorting: {},
        filtering: {},
      },
    });
    mocks.annotateAiPreview.mockResolvedValue({ data: { labels: ['support'] } });
    mocks.annotateAiPreviewState.mockResolvedValue({ data: { rows: [] } });
    mocks.annotateAiPreviewOverride.mockResolvedValue({ data: { ok: true } });
    mocks.annotateAiPreviewClear.mockResolvedValue({ data: { ok: true } });
    mocks.detachAiPreviewedRows.mockResolvedValue({
      data: { node: { id: 'child-node' }, detached_rows: 1 },
    });
    mocks.annotateAiAll.mockResolvedValue({
      data: { node: { id: 'source-node' }, labeled_rows: 1, total_rows: 1 },
    });
    mocks.listAnnotationAiModels.mockResolvedValue({ data: { models: ['openai/gpt-4o'] } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders source and class-description selectors with annotation-specific column pickers', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    expect(screen.getByRole('region', { name: 'Annotation Setup' })).toBeInTheDocument();
    expect(screen.getByText('Selected Data Blocks')).toBeInTheDocument();
    expect(screen.getByText('Class Descriptions')).toBeInTheDocument();

    const sourceAddon = screen.getByTestId('Selected Data Blocks-addon');
    expect(within(sourceAddon).getByText('Annotation Column')).toBeInTheDocument();
    await user.click(within(sourceAddon).getByRole('combobox', { name: 'Annotation Column' }));
    expect(await screen.findByRole('option', { name: 'Start new annotation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'existing_annotation' })).toBeInTheDocument();

    const classAddon = screen.getByTestId('Class Description Node-addon');
    expect(within(classAddon).getByText('Class Column')).toBeInTheDocument();
    expect(within(classAddon).getByText('Description Column')).toBeInTheDocument();
    expect(mocks.useTabNodeInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        selectorId: 'classDescriptions',
      }),
    );
  });

  it('opts all annotation selectors into the visible add-request chooser', () => {
    renderAnnotationFeature();

    expect(mocks.useTabNodeInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        selectorId: 'source',
        consumeNodeInputRequests: false,
      }),
    );
    expect(mocks.useTabNodeInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        selectorId: 'classDescriptions',
        consumeNodeInputRequests: false,
      }),
    );
    expect(mocks.useTabNodeInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        selectorId: 'exampleNodes',
        consumeNodeInputRequests: false,
      }),
    );
  });

  it('nests the class-description setup inside the annotation parameter card', () => {
    renderAnnotationFeature();

    const annotationPanel = screen.getByRole('region', { name: 'Annotation Parameter Panel' });
    const classSetup = within(annotationPanel).getByRole('region', {
      name: 'Class Description Setup',
    });

    expect(classSetup).toBeInTheDocument();
  });

  it('shows a Start button when the annotation column is "Start new annotation"', () => {
    renderAnnotationFeature();

    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('switches to a Resume button when an existing annotation column is selected', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const sourceAddon = screen.getByTestId('Selected Data Blocks-addon');
    await user.click(within(sourceAddon).getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(await screen.findByRole('option', { name: 'existing_annotation' }));

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('shows a New Column Name input with a default placeholder for a new annotation', () => {
    renderAnnotationFeature();

    const input = screen.getByRole('textbox', { name: 'New Column Name' });
    expect(input).toHaveAttribute('placeholder', 'annotation');
  });

  it('defaults to "annotation_1" when an "annotation" column already exists', () => {
    mocks.useTabNodeInputs.mockImplementation((config: { selectorId?: string }) =>
      config.selectorId === 'classDescriptions'
        ? classNodeInputs()
        : sourceNodeInputs({
            resolvedNodes: [
              {
                id: 'source-node',
                name: 'Source',
                node: {
                  id: 'source-node',
                  name: 'Source',
                  columns: ['text', 'annotation'],
                  schema: { text: 'String', annotation: 'String' },
                },
                column: 'text',
                columnOptions: [
                  { name: 'text', dataType: 'string' },
                  { name: 'annotation', dataType: 'string' },
                ],
              },
            ],
          }),
    );

    renderAnnotationFeature();

    expect(screen.getByRole('textbox', { name: 'New Column Name' })).toHaveAttribute(
      'placeholder',
      'annotation_1',
    );
  });

  it('hides the New Column Name input when resuming an existing column', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const sourceAddon = screen.getByTestId('Selected Data Blocks-addon');
    await user.click(within(sourceAddon).getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(await screen.findByRole('option', { name: 'existing_annotation' }));

    expect(screen.queryByRole('textbox', { name: 'New Column Name' })).not.toBeInTheDocument();
  });

  it('reparents the class node under the source node and shows annotation results on Start', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(mocks.setAnnotationClassParent).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', node_id: 'classes-node' },
        body: { parent_node_id: 'source-node' },
      }),
    );
    expect(await screen.findByRole('region', { name: 'Annotation Results' })).toBeInTheDocument();
    expect(await screen.findByText('hello world')).toBeInTheDocument();
  });

  it('creates the annotation column and leaves new-annotation mode on Start', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    expect(screen.getByRole('textbox', { name: 'New Column Name' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(mocks.createAnnotationColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', node_id: 'source-node' },
        body: { column_name: 'annotation' },
      }),
    );
    // New-annotation mode ends: the run button flips to Reset and the
    // new-column-name input disappears because the picker now resumes a column.
    expect(await screen.findByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New Column Name' })).not.toBeInTheDocument();
  });

  it('locks the column picker after Start and returns to resume mode on Reset', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    const resetButton = await screen.findByRole('button', { name: 'Reset' });
    expect(
      within(screen.getByTestId('Selected Data Blocks-addon')).getByRole('combobox', {
        name: 'Annotation Column',
      }),
    ).toBeDisabled();
    expect(await screen.findByRole('region', { name: 'Annotation Results' })).toBeInTheDocument();

    await user.click(resetButton);

    // Reset keeps the created column (resume mode): the button reads Resume, the
    // picker is editable again, the new-column-name input stays hidden, and the
    // results are cleared.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(
      within(screen.getByTestId('Selected Data Blocks-addon')).getByRole('combobox', {
        name: 'Annotation Column',
      }),
    ).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: 'New Column Name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Annotation Results' })).not.toBeInTheDocument();
  });

  it('shows paginated annotation results instead of a preview', async () => {
    const user = userEvent.setup();
    mocks.getNodeDataByWorkspaceId.mockImplementation(
      ({ query }: { query?: { page?: number; page_size?: number } }) =>
        Promise.resolve({
          data: {
            columns: ['text', 'annotation'],
            data: [
              {
                text: query?.page === 2 ? 'second page row' : 'first page row',
                annotation: '',
              },
            ],
            dtypes: { text: 'String', annotation: 'String' },
            pagination: {
              page: query?.page ?? 1,
              page_size: query?.page_size ?? 50,
              total_rows: 75,
              total_pages: 2,
            },
            sorting: {},
            filtering: {},
          },
        }),
    );
    renderAnnotationFeature();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    const resultsPanel = await screen.findByRole('region', { name: 'Annotation Results' });
    expect(within(resultsPanel).getByRole('heading', { name: 'Annotations' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Annotation Preview' })).not.toBeInTheDocument();
    expect(await within(resultsPanel).findByText('first page row')).toBeInTheDocument();

    await user.click(within(resultsPanel).getByRole('link', { name: 'Go to next page' }));

    expect(mocks.getNodeDataByWorkspaceId).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ page: 2, page_size: 50 }),
      }),
    );
    expect(await within(resultsPanel).findByText('second page row')).toBeInTheDocument();
  });

  it('clears a seeded annotation cell when the None option is picked', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    // Resume the existing column so the cell seeds from the saved value.
    const sourceAddon = screen.getByTestId('Selected Data Blocks-addon');
    await user.click(within(sourceAddon).getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(await screen.findByRole('option', { name: 'existing_annotation' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    const resultsPanel = await screen.findByRole('region', { name: 'Annotation Results' });
    const cell = await within(resultsPanel).findByRole('combobox', { name: 'Class for row 1' });
    expect(cell).toHaveTextContent('support');

    // The leading "None" option resets the cell back to the empty placeholder.
    await user.click(cell);
    await user.click(await screen.findByRole('option', { name: 'None' }));

    expect(
      within(resultsPanel).getByRole('combobox', { name: 'Class for row 1' }),
    ).toHaveTextContent('Select class');
    // Clearing persists a null cell to the resumed annotation column.
    expect(mocks.setAnnotationCell).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', node_id: 'source-node' },
        body: { column_name: 'existing_annotation', row_index: 0, value: null },
      }),
    );
  });

  it('persists the chosen class to the annotation column when a cell is set', async () => {
    const user = userEvent.setup();
    // Seed the row with an empty annotation so picking a class is a real change
    // (re-selecting the already-seeded value would not fire onValueChange).
    mocks.getNodeDataByWorkspaceId.mockResolvedValue({
      data: {
        columns: ['text', 'existing_annotation'],
        data: [{ text: 'hello world', existing_annotation: '' }],
        dtypes: { text: 'String', existing_annotation: 'String' },
        pagination: { page: 1, page_size: 50, total_rows: 1, total_pages: 1 },
        sorting: {},
        filtering: {},
      },
    });
    renderAnnotationFeature();

    // Resume the existing column so the dropdown options come from the class node.
    const sourceAddon = screen.getByTestId('Selected Data Blocks-addon');
    await user.click(within(sourceAddon).getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(await screen.findByRole('option', { name: 'existing_annotation' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    const resultsPanel = await screen.findByRole('region', { name: 'Annotation Results' });
    const cell = await within(resultsPanel).findByRole('combobox', { name: 'Class for row 1' });

    await user.click(cell);
    await user.click(await screen.findByRole('option', { name: 'support' }));

    expect(
      within(resultsPanel).getByRole('combobox', { name: 'Class for row 1' }),
    ).toHaveTextContent('support');
    expect(mocks.setAnnotationCell).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', node_id: 'source-node' },
        body: { column_name: 'existing_annotation', row_index: 0, value: 'support' },
      }),
    );
  });

  it('shows annotation results without reparenting when resuming an existing column', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const sourceAddon = screen.getByTestId('Selected Data Blocks-addon');
    await user.click(within(sourceAddon).getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(await screen.findByRole('option', { name: 'existing_annotation' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    expect(mocks.setAnnotationClassParent).not.toHaveBeenCalled();
    expect(await screen.findByRole('region', { name: 'Annotation Results' })).toBeInTheDocument();
  });

  it('creates and selects a class-description node from the add-new action', async () => {
    const user = userEvent.setup();
    const onTabInputSetChange = vi.fn();

    renderAnnotationFeature({ onTabInputSetChange });

    await user.click(screen.getByRole('button', { name: 'Add new' }));

    expect(mocks.createAnnotationClassDescriptions).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer test' },
      path: { workspace_id: 'workspace-1' },
      throwOnError: true,
    });
    expect(onTabInputSetChange).toHaveBeenCalledWith('classDescriptions', [
      { node_id: 'new-class-node', column: 'class' },
    ]);
  });

  it('shows classes compactly and edits them through the Edit dialog', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    expect(within(classSetup).getByRole('button', { name: 'Add new' })).toBeInTheDocument();

    // Compact card: class name shown as a badge, description text hidden.
    expect(await within(classSetup).findByText('support')).toBeInTheDocument();
    expect(within(classSetup).queryByText('Supportive stance')).not.toBeInTheDocument();
    expect(within(classSetup).queryByRole('textbox', { name: 'Class 1' })).not.toBeInTheDocument();

    // Open the Edit dialog and rename a class; the change persists on blur.
    await user.click(within(classSetup).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit classes' });
    const classCell = within(dialog).getByRole('textbox', { name: 'Class 1' });
    expect(classCell).toHaveValue('support');
    expect(within(dialog).getByRole('textbox', { name: 'Description 1' })).toHaveValue(
      'Supportive stance',
    );

    await user.clear(classCell);
    await user.type(classCell, 'critical');
    await user.tab();

    expect(mocks.updateAnnotationClassDescriptions).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer test' },
      path: { workspace_id: 'workspace-1', node_id: 'classes-node' },
      body: {
        class_column: 'class',
        description_column: 'description',
        rows: [{ class: 'critical', description: 'Supportive stance' }],
      },
      throwOnError: true,
    });
  });

  it('reveals a class description in a hover tooltip when one exists', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    // The compact card shows only the class name; the description lives in a tooltip.
    const chip = await within(classSetup).findByText('support');
    expect(within(classSetup).queryByText('Supportive stance')).not.toBeInTheDocument();

    // Hovering the chip surfaces the description through the Radix tooltip portal.
    await user.hover(chip);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Supportive stance');
  });

  it('keeps the class Edit button enabled after annotation starts', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    // Wait for the class list to load so the Edit trigger leaves its loading state.
    await within(classSetup).findByText('support');
    expect(within(classSetup).getByRole('button', { name: 'Edit' })).toBeEnabled();

    // Start locks the rest of the setup card, but classes must stay editable.
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByRole('region', { name: 'Annotation Results' });

    expect(within(classSetup).getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('deletes a class from the Edit dialog and persists the remaining classes', async () => {
    const user = userEvent.setup();
    mocks.getAnnotationClassDescriptions.mockResolvedValue({
      data: {
        class_column: 'class',
        description_column: 'description',
        rows: [
          { class: 'support', description: 'Supportive stance' },
          { class: 'critical', description: 'Critical stance' },
        ],
      },
    });
    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    await within(classSetup).findByText('support');

    await user.click(within(classSetup).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit classes' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete class 1' }));

    expect(mocks.updateAnnotationClassDescriptions).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer test' },
      path: { workspace_id: 'workspace-1', node_id: 'classes-node' },
      body: {
        class_column: 'class',
        description_column: 'description',
        rows: [{ class: 'critical', description: 'Critical stance' }],
      },
      throwOnError: true,
    });
  });

  it('adds a new class row from the Edit dialog', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    await within(classSetup).findByText('support');

    await user.click(within(classSetup).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit classes' });
    await user.click(within(dialog).getByRole('button', { name: 'Add class' }));

    expect(mocks.updateAnnotationClassDescriptions).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer test' },
      path: { workspace_id: 'workspace-1', node_id: 'classes-node' },
      body: {
        class_column: 'class',
        description_column: 'description',
        rows: [
          { class: 'support', description: 'Supportive stance' },
          { class: '', description: '' },
        ],
      },
      throwOnError: true,
    });
  });

  it('collapses extra class names into a "+N more" badge in the compact card', async () => {
    mocks.getAnnotationClassDescriptions.mockResolvedValue({
      data: {
        class_column: 'class',
        description_column: 'description',
        rows: Array.from({ length: 22 }, (_, index) => ({
          class: `class-${String(index + 1)}`,
          description: `Description ${String(index + 1)}`,
        })),
      },
    });

    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    expect(await within(classSetup).findByText('class-20')).toBeInTheDocument();
    expect(within(classSetup).queryByText('class-21')).not.toBeInTheDocument();
    expect(within(classSetup).getByText('+2 more')).toBeInTheDocument();
  });

  it('renders the optional example selector as another shared node-input target in AI mode', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    await user.click(screen.getByRole('switch', { name: 'Toggle AI annotation mode' }));

    expect(screen.getByText('Example Node')).toBeInTheDocument();
    expect(mocks.useTabNodeInputs).toHaveBeenCalledWith(
      expect.objectContaining({ selectorId: 'exampleNodes' }),
    );
  });

  it('gates the Start button to manual mode and reveals AI settings when toggled', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    // Manual mode (default): the Start button is shown and AI controls are hidden.
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    const aiToggle = screen.getByRole('switch', { name: 'Toggle AI annotation mode' });
    expect(aiToggle).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Provider' })).not.toBeInTheDocument();

    // Flip to AI mode: the Start button disappears and the provider-card dropdown
    // plus example-node controls appear.
    await user.click(aiToggle);
    expect(aiToggle).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Provider' })).toBeInTheDocument();
    expect(screen.getByText('Example Node')).toBeInTheDocument();
    const exampleAddon = screen.getByTestId('Example Node-addon');
    expect(within(exampleAddon).getByText('Annotation Column')).toBeInTheDocument();
  });

  it('runs the Start lifecycle on first Preview and shows the AI preview, not manual results', async () => {
    const user = userEvent.setup();
    // OpenRouter needs a key to annotate; seed one so the Preview button enables.
    usePreferencesStore.setState({
      annotationAiApiKeys: { openrouter: 'sk-test' },
      annotationAiCustomProviders: [],
    });
    // Start directly in AI mode with a model already chosen (persisted setting).
    renderAnnotationFeature({
      tabSettings: { annotationMode: 'ai', aiProvider: 'openrouter', aiModel: 'gpt-4o' },
    });

    await user.click(screen.getByRole('button', { name: 'Preview' }));

    // Preview reuses the manual Start lifecycle for a "Start new annotation"
    // column: it creates the column and reparents the class node under the source.
    expect(mocks.createAnnotationColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', node_id: 'source-node' },
        body: { column_name: 'annotation' },
      }),
    );
    expect(mocks.setAnnotationClassParent).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', node_id: 'classes-node' },
        body: { parent_node_id: 'source-node' },
      }),
    );

    // The button flips to Close preview and the AI preview panel appears — the
    // manual results panel never shows in AI mode.
    expect(await screen.findByRole('button', { name: 'Close preview' })).toBeInTheDocument();
    expect(
      await screen.findByRole('region', { name: 'AI Annotation Preview' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Annotation Results' })).not.toBeInTheDocument();

    // Nodes lock (the source annotation-column picker disables)…
    expect(
      within(screen.getByTestId('Selected Data Blocks-addon')).getByRole('combobox', {
        name: 'Annotation Column',
      }),
    ).toBeDisabled();
    // …but the class Edit button stays enabled, exactly like manual mode.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('closing the AI preview unlocks the panel and can reopen without recreating the column', async () => {
    const user = userEvent.setup();
    usePreferencesStore.setState({
      annotationAiApiKeys: { openrouter: 'sk-test' },
      annotationAiCustomProviders: [],
    });
    renderAnnotationFeature({
      tabSettings: { annotationMode: 'ai', aiProvider: 'openrouter', aiModel: 'gpt-4o' },
    });

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const closeButton = await screen.findByRole('button', { name: 'Close preview' });

    // The source annotation-column picker is locked while previewing.
    const columnPicker = () =>
      within(screen.getByTestId('Selected Data Blocks-addon')).getByRole('combobox', {
        name: 'Annotation Column',
      });
    expect(columnPicker()).toBeDisabled();

    // Close hides the panel and unlocks the parameter panel (like manual Reset),
    // but keeps the source pointed at the created column (resume mode).
    await user.click(closeButton);
    expect(screen.queryByRole('region', { name: 'AI Annotation Preview' })).not.toBeInTheDocument();
    expect(columnPicker()).toBeEnabled();

    // Reopening does not create the column again — it already exists (resume).
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      await screen.findByRole('region', { name: 'AI Annotation Preview' }),
    ).toBeInTheDocument();
    expect(columnPicker()).toBeDisabled();
    expect(mocks.createAnnotationColumn).toHaveBeenCalledTimes(1);
  });

  it('disables the AI Preview button when the class node has no classes', async () => {
    // A runnable provider/model/key so the ONLY missing ingredient is a class to
    // classify into — isolating the class-count gate.
    usePreferencesStore.setState({
      annotationAiApiKeys: { openrouter: 'sk-test' },
      annotationAiCustomProviders: [],
    });
    // The class node resolves, but its class column holds no rows.
    mocks.getAnnotationClassDescriptions.mockResolvedValue({
      data: { class_column: 'class', description_column: 'description', rows: [] },
    });
    renderAnnotationFeature({ tabSettings: { annotationMode: 'ai', aiModel: 'gpt-4o' } });

    const previewButton = await screen.findByRole('button', { name: 'Preview' });
    // Stays disabled after the class-count query settles on an empty list.
    await waitFor(() => expect(previewButton).toBeDisabled());
  });

  it('enables the AI Preview button once the class node has at least one class', async () => {
    usePreferencesStore.setState({
      annotationAiApiKeys: { openrouter: 'sk-test' },
      annotationAiCustomProviders: [],
    });
    // The default class mock returns one class ("support"), so the same runnable
    // config that was gated above now enables Preview once the query resolves.
    renderAnnotationFeature({
      tabSettings: { annotationMode: 'ai', aiProvider: 'openrouter', aiModel: 'gpt-4o' },
    });

    const previewButton = await screen.findByRole('button', { name: 'Preview' });
    await waitFor(() => expect(previewButton).toBeEnabled());
  });

  it('clears the server-side preview cache when the AI preview is closed', async () => {
    const user = userEvent.setup();
    usePreferencesStore.setState({
      annotationAiApiKeys: { openrouter: 'sk-test' },
      annotationAiCustomProviders: [],
    });
    renderAnnotationFeature({
      tabSettings: { annotationMode: 'ai', aiProvider: 'openrouter', aiModel: 'gpt-4o' },
    });

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const closeButton = await screen.findByRole('button', { name: 'Close preview' });
    await user.click(closeButton);

    // Closing is an explicit "done previewing", so the node's cached preview
    // session is dropped on the server (unlike a tab switch, which keeps it).
    expect(mocks.annotateAiPreviewClear).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { workspace_id: 'workspace-1', node_id: 'source-node' },
      }),
    );
  });

  it('opens an empty provider dropdown with only the add-provider action by default', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();
    await user.click(screen.getByRole('switch', { name: 'Toggle AI annotation mode' }));

    await user.click(screen.getByRole('button', { name: 'Provider' }));

    expect(screen.getByRole('button', { name: 'Add provider' })).toBeInTheDocument();
    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument();
  });

  it('saves a built-in provider card with its API key and model', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();
    await user.click(screen.getByRole('switch', { name: 'Toggle AI annotation mode' }));

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    await user.type(screen.getByLabelText('API key'), 'sk-secret');
    await user.type(screen.getByLabelText('Model'), 'openai/gpt-4o');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    const keys = usePreferencesStore.getState().annotationAiApiKeys;
    const providerId = Object.keys(keys)[0];
    expect(providerId).toMatch(/^provider:openrouter:/);
    expect(providerId ? keys[providerId] : undefined).toBe('sk-secret');
    expect(screen.getByRole('button', { name: 'Provider' })).toHaveTextContent('OpenRouter');
    expect(screen.getByRole('button', { name: 'Provider' })).toHaveTextContent('openai/gpt-4o');
    expect(fetchMock).toHaveBeenCalledWith(
      OPENROUTER_MODELS_URL,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('saves a custom provider from the dialog and selects it', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();
    await user.click(screen.getByRole('switch', { name: 'Toggle AI annotation mode' }));

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    await user.click(screen.getByRole('combobox', { name: 'Provider type' }));
    await user.click(await screen.findByRole('option', { name: 'Custom base URL' }));

    await user.type(screen.getByLabelText('Provider name'), 'My LLM');
    await user.type(screen.getByLabelText('Base URL'), 'https://llm.example/v1');
    await user.type(screen.getByLabelText(/API key/), 'sk-custom');
    await user.type(screen.getByLabelText('Model'), 'llm-large');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    // Persisted to preferences and selected in the dropdown.
    expect(usePreferencesStore.getState().annotationAiCustomProviders).toEqual([
      expect.objectContaining({ name: 'My LLM', base_url: 'https://llm.example/v1' }),
    ]);
    expect(screen.getByRole('button', { name: 'Provider' })).toHaveTextContent('My LLM');
    expect(screen.getByRole('button', { name: 'Provider' })).toHaveTextContent('llm-large');
  });

  it('hydrates AI mode, provider, model, and prompt from persisted tab settings', () => {
    const providerId = 'provider:openai:test';
    usePreferencesStore.setState({
      annotationAiApiKeys: { [providerId]: 'sk-test' },
      annotationAiCustomProviders: [],
    });
    renderAnnotationFeature({
      tabSettings: {
        annotationMode: 'ai',
        aiProvider: providerId,
        aiModel: 'gpt-4o-mini',
        aiProviderModels: JSON.stringify({ [providerId]: 'gpt-4o-mini' }),
        aiPrompt: 'Classify the stance.',
      },
    });

    // The switch starts in AI mode and the AI controls reflect the saved values.
    expect(screen.getByRole('switch', { name: 'Toggle AI annotation mode' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Provider' })).toHaveTextContent('OpenAI');
    expect(screen.getByRole('button', { name: 'Provider' })).toHaveTextContent('gpt-4o-mini');
    expect(screen.getByLabelText(/Prompt/)).toHaveValue('Classify the stance.');
  });

  it('write-through persists the mode switch and provider selection', async () => {
    const user = userEvent.setup();
    const onTabSettingChange = vi.fn();
    const providerId = 'provider:anthropic:test';
    usePreferencesStore.setState({
      annotationAiApiKeys: { [providerId]: 'sk-test' },
      annotationAiCustomProviders: [],
    });
    renderAnnotationFeature({ onTabSettingChange });

    // Flipping the switch persists the mode immediately.
    await user.click(screen.getByRole('switch', { name: 'Toggle AI annotation mode' }));
    expect(onTabSettingChange).toHaveBeenCalledWith('annotationMode', 'ai');

    // Choosing a provider card persists both the card id and its model immediately.
    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByText('Anthropic'));
    expect(onTabSettingChange).toHaveBeenCalledWith('aiProvider', providerId);
    expect(onTabSettingChange).toHaveBeenCalledWith('aiModel', '');
  });

  it('commits provider models on save and prompt on blur', async () => {
    mocks.listAnnotationAiModels.mockResolvedValue({ data: { models: ['openai/gpt-4o'] } });
    const user = userEvent.setup();
    const onTabSettingChange = vi.fn();
    renderAnnotationFeature({ onTabSettingChange });
    await user.click(screen.getByRole('switch', { name: 'Toggle AI annotation mode' }));

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    await user.type(screen.getByLabelText('API key'), 'sk-secret');
    await user.type(screen.getByLabelText('Model'), 'gpt-custom');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    expect(onTabSettingChange).toHaveBeenCalledWith('aiModel', 'gpt-custom');
    expect(onTabSettingChange).toHaveBeenCalledWith(
      'aiProviderModels',
      expect.stringContaining('gpt-custom'),
    );

    // Same for the prompt textarea.
    const promptInput = screen.getByLabelText(/Prompt/);
    await user.click(promptInput);
    await user.type(promptInput, 'label it');
    await user.click(screen.getByText('Manual'));
    expect(onTabSettingChange).toHaveBeenCalledWith('aiPrompt', 'label it');
  });

  it('hydrates the Model Configuration knobs from persisted tab settings', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature({
      tabSettings: {
        annotationMode: 'ai',
        aiModel: 'gpt-4o',
        aiTemperature: '0.8',
        aiReasoningEnabled: 'true',
        aiReasoningEffort: 'high',
      },
    });

    // The section is collapsed by default; open it to read the controls.
    await user.click(screen.getByText('Model Configuration'));
    expect(screen.getByLabelText('Temperature')).toHaveValue(0.8);
    expect(screen.getByRole('switch', { name: 'Toggle reasoning' })).toBeChecked();
    expect(screen.getByLabelText('Thinking effort')).toHaveTextContent('high');
  });

  it('write-through persists reasoning, effort, and temperature', async () => {
    const user = userEvent.setup();
    const onTabSettingChange = vi.fn();
    renderAnnotationFeature({
      tabSettings: { annotationMode: 'ai', aiModel: 'gpt-4o' },
      onTabSettingChange,
    });

    await user.click(screen.getByText('Model Configuration'));

    // Enabling reasoning persists immediately and reveals the effort select.
    await user.click(screen.getByRole('switch', { name: 'Toggle reasoning' }));
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEnabled', 'true');

    await user.click(screen.getByLabelText('Thinking effort'));
    await user.click(await screen.findByRole('option', { name: 'high' }));
    expect(onTabSettingChange).toHaveBeenCalledWith('aiReasoningEffort', 'high');

    // Temperature commits on blur, clamped to the supported range.
    const temperature = screen.getByLabelText('Temperature');
    await user.clear(temperature);
    await user.type(temperature, '1.5');
    await user.tab();
    expect(onTabSettingChange).toHaveBeenCalledWith('aiTemperature', '1.5');
  });
});
