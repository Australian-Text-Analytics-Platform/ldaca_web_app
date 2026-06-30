import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AnnotationFeature from '../AnnotationFeature';
import type {
  NodeInputColumnAddonArgs,
  NodeInputsPanelProps,
} from '@/features/views/common/components/NodeInputsPanel';
import type { UseTabNodeInputsResult } from '@/features/views/common/nodeInputs';
import type { NodeInputRequestsStore } from '@/stores/nodeInputRequestsStore';

const mocks = vi.hoisted(() => ({
  createAnnotationClassDescriptions: vi.fn(),
  getAnnotationClassDescriptions: vi.fn(),
  updateAnnotationClassDescriptions: vi.fn(),
  setAnnotationClassParent: vi.fn(),
  getNodeData: vi.fn(),
  useAuth: vi.fn(),
  useWorkspaceData: vi.fn(),
  useTabNodeInputs: vi.fn(),
  useNodeInputRequestsStore: vi.fn(),
}));

vi.mock('@/api', () => ({
  createAnnotationClassDescriptions: mocks.createAnnotationClassDescriptions,
  getAnnotationClassDescriptions: mocks.getAnnotationClassDescriptions,
  updateAnnotationClassDescriptions: mocks.updateAnnotationClassDescriptions,
  setAnnotationClassParent: mocks.setAnnotationClassParent,
  getNodeData: mocks.getNodeData,
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
              {props.renderColumnAddon?.(addonArgs)}
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
): UseTabNodeInputsResult =>
  ({
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
  });

const classNodeInputs = (
  overrides: Partial<UseTabNodeInputsResult> = {},
): UseTabNodeInputsResult =>
  ({
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

describe('AnnotationFeature', () => {
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
    mocks.useAuth.mockReturnValue({
      getAuthHeaders: () => ({ Authorization: 'Bearer test' }),
    });
    mocks.useWorkspaceData.mockReturnValue({
      currentWorkspaceId: 'workspace-1',
    });
    nodeInputRequestsStore();
    mocks.useTabNodeInputs.mockImplementation((config: { selectorId?: string }) =>
      config.selectorId === 'classDescriptions' ? classNodeInputs() : sourceNodeInputs(),
    );
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
    mocks.getNodeData.mockResolvedValue({
      data: {
        columns: ['text', 'existing_annotation'],
        data: [{ text: 'hello world', existing_annotation: 'support' }],
        dtypes: { text: 'String', existing_annotation: 'String' },
        pagination: { page: 1, page_size: 50, total_rows: 1, total_pages: 1 },
        sorting: {},
        filtering: {},
      },
    });
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
    expect(within(classAddon).getByText('Description')).toBeInTheDocument();
    expect(mocks.useTabNodeInputs).toHaveBeenCalledWith(
      expect.objectContaining({ consumeNodeInputRequests: false, selectorId: 'source' }),
    );
    expect(mocks.useTabNodeInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        consumeNodeInputRequests: false,
        selectorId: 'classDescriptions',
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
        path: { node_id: 'classes-node' },
        body: { parent_node_id: 'source-node' },
      }),
    );
    expect(await screen.findByRole('region', { name: 'Annotation Results' })).toBeInTheDocument();
    expect(await screen.findByText('hello world')).toBeInTheDocument();
  });

  it('shows paginated annotation results instead of a preview', async () => {
    const user = userEvent.setup();
    mocks.getNodeData.mockImplementation(
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

    expect(mocks.getNodeData).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ page: 2, page_size: 50 }),
      }),
    );
    expect(await within(resultsPanel).findByText('second page row')).toBeInTheDocument();
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
      throwOnError: true,
    });
    expect(onTabInputSetChange).toHaveBeenCalledWith('classDescriptions', [
      { node_id: 'new-class-node', column: 'class' },
    ]);
  });

  it('shows editable class-description rows under the class node selector', async () => {
    const user = userEvent.setup();
    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    expect(within(classSetup).getByRole('button', { name: 'Add new' })).toBeInTheDocument();

    const classCell = await within(classSetup).findByRole('textbox', { name: 'Class 1' });
    const descriptionCell = within(classSetup).getByRole('textbox', { name: 'Description 1' });
    expect(classCell).toHaveValue('support');
    expect(descriptionCell).toHaveValue('Supportive stance');

    await user.clear(classCell);
    await user.type(classCell, 'critical');
    await user.tab();

    expect(mocks.updateAnnotationClassDescriptions).toHaveBeenCalledWith({
      headers: { Authorization: 'Bearer test' },
      path: { node_id: 'classes-node' },
      body: {
        class_column: 'class',
        description_column: 'description',
        rows: [{ class: 'critical', description: 'Supportive stance' }],
      },
      throwOnError: true,
    });
  });

  it('shows only the first 30 class-description rows until expanded', async () => {
    const user = userEvent.setup();
    mocks.getAnnotationClassDescriptions.mockResolvedValue({
      data: {
        class_column: 'class',
        description_column: 'description',
        rows: Array.from({ length: 31 }, (_, index) => ({
          class: `class-${String(index + 1)}`,
          description: `Description ${String(index + 1)}`,
        })),
      },
    });

    renderAnnotationFeature();

    const classSetup = screen.getByRole('region', { name: 'Class Description Setup' });
    expect(await within(classSetup).findByRole('textbox', { name: 'Class 30' })).toHaveValue(
      'class-30',
    );
    expect(within(classSetup).queryByRole('textbox', { name: 'Class 31' })).not.toBeInTheDocument();

    await user.click(within(classSetup).getByRole('button', { name: 'Expand all' }));

    expect(await within(classSetup).findByRole('textbox', { name: 'Class 31' })).toHaveValue(
      'class-31',
    );
  });

  it('routes workspace plus requests to the source selector after user choice', async () => {
    const user = userEvent.setup();
    const addSourceNodes = vi.fn(() => []);
    const addClassNodes = vi.fn(() => []);
    const consume = vi.fn();
    nodeInputRequestsStore({
      requests: [{ id: 12, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-a'] }],
      consume,
    });
    mocks.useTabNodeInputs.mockImplementation((config: { selectorId?: string }) =>
      config.selectorId === 'classDescriptions'
        ? classNodeInputs({ addNodes: addClassNodes, canAddMore: true })
        : sourceNodeInputs({ addNodes: addSourceNodes, canAddMore: true }),
    );

    renderAnnotationFeature();

    const chooser = screen.getByRole('dialog', { name: 'Choose annotation node selector' });
    expect(chooser).toBeInTheDocument();

    await user.click(within(chooser).getByRole('button', { name: 'Add to Selected Data Blocks' }));

    expect(addSourceNodes).toHaveBeenCalledWith(['node-a']);
    expect(addClassNodes).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith(12);
  });

  it('routes workspace plus requests to the class-description selector after user choice', async () => {
    const user = userEvent.setup();
    const addSourceNodes = vi.fn(() => []);
    const addClassNodes = vi.fn(() => []);
    const consume = vi.fn();
    nodeInputRequestsStore({
      requests: [{ id: 13, workspaceId: 'workspace-1', view: 'annotation', nodeIds: ['node-b'] }],
      consume,
    });
    mocks.useTabNodeInputs.mockImplementation((config: { selectorId?: string }) =>
      config.selectorId === 'classDescriptions'
        ? classNodeInputs({ addNodes: addClassNodes, canAddMore: true })
        : sourceNodeInputs({ addNodes: addSourceNodes, canAddMore: true }),
    );

    renderAnnotationFeature();

    const chooser = screen.getByRole('dialog', { name: 'Choose annotation node selector' });
    await user.click(within(chooser).getByRole('button', { name: 'Add to Class Description' }));

    expect(addClassNodes).toHaveBeenCalledWith(['node-b']);
    expect(addSourceNodes).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledWith(13);
  });
});
