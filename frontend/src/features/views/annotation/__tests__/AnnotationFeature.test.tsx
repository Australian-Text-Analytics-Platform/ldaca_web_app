import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Analysis } from '@/api';
import type { RunAnalysisOptions } from '../../common/hooks/useAnalysisFeature';

async function executeAnalysis<TAnalysis extends Analysis>(options: RunAnalysisOptions<TAnalysis>) {
  try {
    options.resetBeforeRun?.();
    await options.prepare?.();
    const response = await options.submit();
    options.onSuccess?.(response);
    return response;
  } catch (error) {
    options.onError(error);
    return null;
  }
}

vi.mock('@/features/guidance/GuidanceContext', () => ({
  useGuidance: () => ({ reachContextualHint: vi.fn(), startGuidedTour: vi.fn() }),
}));
vi.mock('@/features/guidance/useProgressiveContextualHints', () => ({
  useProgressiveContextualHints: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  createSqlDataBlock: vi.fn(),
  polarsExpressionApply: vi.fn(),
  setInputSet: vi.fn(),
  setSetting: vi.fn(),
  invalidateQueries: vi.fn(),
  clearResults: vi.fn(),
  persistDocumentColumn: vi.fn(),
  setSourceColumn: vi.fn(),
  setExampleColumn: vi.fn(),
  setNodeColor: vi.fn(),
  ensureNodeColors: vi.fn(),
  submitPreview: vi.fn(),
  submitRunAll: vi.fn(),
  exampleSelected: false,
  classSelected: false,
  classRows: [] as { class: string; description: string }[],
  providerConfigurations: [] as {
    id: string;
    name: string;
    provider: 'openai';
    base_url: null;
    has_api_key: boolean;
  }[],
  sourceColumnNames: ['text'] as string[],
  workspaceNodes: [] as { id: string; color: string; shape: [number, number] }[],
  runAllResult: null as { failed_row_count: number; failed_batch_count: number } | null,
}));

vi.mock('@/features/provider-credentials/providerCredentialRequests', () => ({
  submitTabAnalysisWithProviderCredential: mocks.submitPreview,
  submitAnnotationRunAllWithProviderCredential: mocks.submitRunAll,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useQuery: () => ({ data: mocks.runAllResult }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceData', () => ({
  useWorkspaceData: () => ({ currentWorkspaceId: 'workspace-1', nodes: mocks.workspaceNodes }),
}));
vi.mock('@/features/workspace/common/hooks/useNodeColumnInfos', () => ({
  useNodeColumnInfos: () => ({ columnInfoCache: {} }),
}));

vi.mock('@/features/workspace/common/hooks/useWorkspaceActions', () => ({
  useWorkspaceActions: () => ({
    createSqlDataBlock: mocks.createSqlDataBlock,
    polarsExpressionApply: mocks.polarsExpressionApply,
  }),
}));

vi.mock('@/features/views/common/hooks/usePersistNodeDocumentColumn', () => ({
  usePersistNodeDocumentColumn: () => mocks.persistDocumentColumn,
}));

vi.mock('@/features/views/common/hooks/useNodeColorControls', () => ({
  useNodeColorControls: () => ({
    defaultPalette: ['#2563eb'],
    nodeColors: { 'source-1': '#2563eb' },
    setNodeColor: mocks.setNodeColor,
    ensureNodeColors: mocks.ensureNodeColors,
  }),
}));

vi.mock('@/features/views/common/nodeInputs', async (importOriginal) => ({
  ...(await importOriginal()),
  useTabNodeInputs: ({ selectorId }: { selectorId: string }) => {
    const sourceSelected = selectorId === 'source';
    const classSelected = selectorId === 'classDescriptions' && mocks.classSelected;
    const exampleSelected = selectorId === 'exampleNodes' && mocks.exampleSelected;
    const selected = sourceSelected || classSelected || exampleSelected;
    const nodeId = sourceSelected ? 'source-1' : classSelected ? 'class-1' : 'example-1';
    const column = classSelected ? 'class' : 'text';
    const columnNames = classSelected
      ? ['class', 'description']
      : exampleSelected
        ? ['text', 'class']
        : mocks.sourceColumnNames;
    return {
      inputs: selected ? [{ node_id: nodeId, column }] : [],
      resolvedNodes: selected
        ? [
            {
              id: nodeId,
              name: sourceSelected ? 'Source' : classSelected ? 'Codebook' : 'Example',
              column,
              node: { shape: [2380, 21] },
              columnOptions: columnNames.map((name) => ({ name })),
            },
          ]
        : [],
      availableNodes: [],
      graphSelectedIds: [],
      recentPresets: [],
      canAddMore: !sourceSelected,
      addNodes: vi.fn(),
      getAddRejection: vi.fn(() => null),
      removeNode: vi.fn(),
      clear: vi.fn(),
      setColumn: sourceSelected
        ? mocks.setSourceColumn
        : exampleSelected
          ? mocks.setExampleColumn
          : vi.fn(),
    };
  },
}));

vi.mock('@/features/views/common/components/NodeInputsPanel', () => ({
  NodeInputsPanel: ({
    title,
    resolvedNodes,
    renderColumnAddon,
    onColumnChange,
    onNodeColorChange,
  }: {
    title: string;
    resolvedNodes: {
      id: string;
      name: string;
      column: string;
      columnOptions: { name: string }[];
    }[];
    renderColumnAddon?: (args: {
      node: { id: string; name: string };
      nodeId: string;
      index: number;
      color: string;
      column: string;
      columns: string[];
    }) => ReactNode;
    onColumnChange: (nodeId: string, column: string) => void;
    onNodeColorChange?: (nodeId: string, color: string) => void;
  }) => (
    <div>
      {title}
      {resolvedNodes.map((resolved, index) => (
        <div key={resolved.id}>
          <button type="button" onClick={() => onColumnChange(resolved.id, 'body')}>
            Change {title} text column
          </button>
          {onNodeColorChange ? (
            <button type="button" onClick={() => onNodeColorChange(resolved.id, '#dc2626')}>
              Change {title} color
            </button>
          ) : null}
          {renderColumnAddon?.({
            node: { id: resolved.id, name: resolved.name },
            nodeId: resolved.id,
            index,
            color: '#000000',
            column: resolved.column,
            columns: resolved.columnOptions.map((option) => option.name),
          })}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/features/views/common/components/AnalysisCardLayout', () => ({
  AnalysisCardLayout: ({
    children,
    footer,
    actions,
  }: {
    children: ReactNode;
    footer?: ReactNode;
    actions?: {
      onPreview: () => void | Promise<void>;
      onRunAll: () => void | Promise<void>;
      onClear: () => void | Promise<void>;
    };
  }) => (
    <div>
      {children}
      {footer}
      {actions ? (
        <>
          <button type="button" onClick={() => void actions.onPreview()}>
            Preview
          </button>
          <button type="button" onClick={() => void actions.onRunAll()}>
            Run All
          </button>
          <button type="button" onClick={() => void actions.onClear()}>
            Clear Results
          </button>
        </>
      ) : null}
    </div>
  ),
}));

vi.mock('../components/AnnotationClassDescriptionsEditor', () => ({
  AnnotationClassDescriptionsEditor: () => null,
}));

vi.mock('../components/AnnotationAiSettings', () => ({
  AnnotationAiSettings: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/AnnotationResultsPanel', () => ({
  AnnotationResultsPanel: ({
    nodeId,
    textColumn,
    annotationColumn,
    classNodeId,
    correction,
  }: {
    nodeId: string;
    textColumn: string;
    annotationColumn: string;
    classNodeId: string | null;
    correction: { column: string | null; onCreate: () => void };
  }) => (
    <div>
      <span data-testid="manual-review-snapshot">
        {nodeId}:{textColumn}:{annotationColumn}:{classNodeId ?? 'none'}
      </span>
      <span>Correction: {correction.column ?? 'None'}</span>
      <button type="button" onClick={correction.onCreate}>
        Create correction column
      </button>
    </div>
  ),
}));

vi.mock('@/features/views/common/components/RunAllReviewTable', () => ({
  RunAllReviewTable: () => <div>Run All review table</div>,
}));

vi.mock('../hooks/useAnnotationClassDescriptions', () => ({
  useAnnotationClassDescriptions: () => ({ rows: mocks.classRows, query: {} }),
}));

vi.mock('@/features/provider-credentials/useProviderCredentials', () => ({
  useProviderCredentials: () => ({
    annotationProviders: mocks.providerConfigurations,
    revision: 0,
  }),
}));

vi.mock('../../common/hooks/useAnalysisFeature', () => ({
  useAnalysisFeature: () => ({
    request: null,
    result: null,
    isRunning: false,
    isSubmittingRunAll: false,
    isStopping: false,
    runAnalysis: executeAnalysis,
    taskStatus: { tasks: [] },
    banner: null,
    clearResults: mocks.clearResults,
    stopTask: vi.fn(),
  }),
}));

vi.mock('../hooks/useAnnotationAiPreview', () => ({
  useAnnotationAiPreview: () => ({}),
}));

import AnnotationFeature from '../AnnotationFeature';

const runAllAnalysis = (state: 'succeeded' | 'failed', message?: string): Analysis =>
  ({
    id: `run-all-${state}`,
    state,
    error: message ? { code: 'annotation_provider_authentication_failed', message } : null,
    progress: { completed: 0, total: 0, message: null },
    request: {
      kind: 'annotation_run_all',
      source: {
        kind: 'annotation',
        node_id: 'source-1',
        text_column: 'text',
        annotation_column: 'annotation',
        class_node_id: 'class-1',
        class_column: 'class',
        description_column: 'description',
        classes: [{ name: 'support', description: 'Supports the claim' }],
        instruction: '',
        model: 'gpt-test',
        provider: 'openai',
        provider_configuration_id: 'provider-1',
      },
      batch_size: 20,
      processing_mode: 'reprocess_all',
    },
  }) as Analysis;

describe('AnnotationFeature', () => {
  beforeEach(() => {
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.createSqlDataBlock.mockReset();
    mocks.polarsExpressionApply.mockReset();
    mocks.setInputSet.mockReset();
    mocks.setSetting.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.clearResults.mockReset();
    mocks.persistDocumentColumn.mockReset();
    mocks.setSourceColumn.mockReset();
    mocks.setExampleColumn.mockReset();
    mocks.setNodeColor.mockReset();
    mocks.ensureNodeColors.mockReset();
    mocks.submitPreview.mockReset();
    mocks.submitRunAll.mockReset();
    mocks.exampleSelected = false;
    mocks.classSelected = false;
    mocks.classRows = [];
    mocks.providerConfigurations = [];
    mocks.sourceColumnNames = ['text'];
    mocks.workspaceNodes = [];
    mocks.runAllResult = null;
    mocks.createSqlDataBlock.mockResolvedValue({ id: 'class-node-1' });
    mocks.polarsExpressionApply.mockResolvedValue(undefined);
    mocks.clearResults.mockResolvedValue(undefined);
    mocks.ensureNodeColors.mockResolvedValue(undefined);
    mocks.submitPreview.mockResolvedValue({ data: { id: 'analysis-1' } });
    mocks.submitRunAll.mockResolvedValue({ data: { id: 'run-all-1' } });
  });

  it('propagates persisted example sampling settings to Preview and Run All', async () => {
    const user = userEvent.setup();
    mocks.exampleSelected = true;
    mocks.classSelected = true;
    mocks.classRows = [{ class: 'support', description: 'Supports the claim' }];
    mocks.providerConfigurations = [
      {
        id: 'provider-1',
        name: 'OpenAI',
        provider: 'openai',
        base_url: null,
        has_api_key: true,
      },
    ];
    mocks.sourceColumnNames = ['text', 'annotation'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationMode: 'ai',
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
            aiProviderConfigurationId: 'provider-1',
            aiProviderType: 'openai',
            aiProviderModels: JSON.stringify({ 'provider-1': 'gpt-test' }),
            aiMaxExamplesPerClass: '3',
            aiExampleSamplingMethod: 'random',
            aiExampleRandomSeed: '42',
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getAllByLabelText('Annotation Column')[1]);
    await user.click(screen.getByRole('option', { name: 'class' }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() => expect(mocks.submitPreview).toHaveBeenCalledOnce());
    const previewRequest = mocks.submitPreview.mock.calls[0]?.[0].request;
    expect(previewRequest).toMatchObject({
      example_node_id: 'example-1',
      example_text_column: 'text',
      example_annotation_column: 'class',
      max_examples_per_class: 3,
      example_sampling_method: 'random',
      example_random_seed: 42,
    });

    await user.click(screen.getByRole('button', { name: 'Run All' }));
    await waitFor(() => expect(mocks.submitRunAll).toHaveBeenCalledOnce());
    expect(mocks.submitRunAll.mock.calls[0]?.[0].source).toEqual(previewRequest);
  });

  it('persists manual text-column choices for source and example Data Blocks', async () => {
    const user = userEvent.setup();
    mocks.exampleSelected = true;

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: { annotationMode: 'ai' },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Change Selected Data Blocks text column' }),
    );
    expect(screen.getByText('Example Data Block')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Change Example Node text column' }));

    expect(mocks.setSourceColumn).toHaveBeenCalledWith('source-1', 'body');
    expect(mocks.setExampleColumn).toHaveBeenCalledWith('example-1', 'body');
    expect(mocks.persistDocumentColumn.mock.calls).toEqual([
      ['source-1', 'body'],
      ['example-1', 'body'],
    ]);
  });

  it('creates and selects an empty class Data Block from the explicit action', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {},
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: vi.fn(),
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    expect(screen.getByTestId('annotation-node-selector-grid')).toHaveClass(
      '@min-[640px]/annotation-selectors:grid-cols-2',
    );
    expect(screen.getByRole('heading', { name: 'Annotation Data Block', level: 3 })).toHaveClass(
      'mb-3',
    );
    expect(screen.getByRole('heading', { name: 'Codebook', level: 3 })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create New' }));

    expect(mocks.createSqlDataBlock).toHaveBeenCalledWith(
      ['source-1'],
      'SELECT CAST("text" AS VARCHAR) AS "class", CAST("text" AS VARCHAR) AS "description" FROM "source-1" LIMIT 0',
      'Source_codebook',
    );
    expect(mocks.setInputSet).toHaveBeenCalledWith('classDescriptions', [
      { node_id: 'class-node-1', column: 'class' },
    ]);
  });

  it('creates and selects a new annotation column from the picker dialog', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'text' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(screen.getByRole('option', { name: 'Start new annotation' }));

    expect(screen.getByRole('heading', { name: 'Create annotation column' })).toBeInTheDocument();
    const columnName = screen.getByRole('textbox', { name: 'Column name' });
    expect(columnName).toHaveValue('');
    expect(columnName).toHaveAttribute('placeholder', 'annotation');
    await user.click(columnName);
    await user.tab();
    expect(columnName).toHaveValue('annotation');
    expect(columnName).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mocks.polarsExpressionApply).toHaveBeenCalledWith(
      'source-1',
      {
        context: 'with_columns',
        expressions: [
          {
            expression: {
              op: 'cast',
              operand: { op: 'literal', value: null },
              dtype: 'string',
              strict: false,
            },
            alias: 'annotation',
          },
        ],
        group_by: [],
        name: null,
      },
      'update',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Annotation Column' })).toHaveTextContent(
      'annotation',
    );
    expect(screen.queryByLabelText('New Column Name')).not.toBeInTheDocument();
    expect(mocks.setSetting).toHaveBeenCalledWith(
      'annotationTargets',
      JSON.stringify({ 'source-1': 'annotation' }),
    );
  });

  it('labels the manual review action Start before opening and Close while open', async () => {
    const user = userEvent.setup();
    mocks.sourceColumnNames = ['text', 'annotation'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(mocks.ensureNodeColors).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('keeps the open Manual table bound to its Start-time snapshot', async () => {
    const user = userEvent.setup();
    mocks.sourceColumnNames = ['text', 'annotation'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByTestId('manual-review-snapshot')).toHaveTextContent(
      'source-1:text:annotation:none',
    );

    await user.click(screen.getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(screen.getByRole('option', { name: 'text' }));
    expect(screen.getByTestId('manual-review-snapshot')).toHaveTextContent(
      'source-1:text:annotation:none',
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByTestId('manual-review-snapshot')).toHaveTextContent(
      'source-1:text:text:none',
    );
  });

  it('previews the main Data Block color and aborts Manual Start when persistence fails', async () => {
    const user = userEvent.setup();
    mocks.sourceColumnNames = ['text', 'annotation'];
    mocks.ensureNodeColors.mockRejectedValue(new Error('color write failed'));

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change Selected Data Blocks color' }));
    expect(mocks.setNodeColor).toHaveBeenCalledWith('source-1', '#dc2626');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(mocks.ensureNodeColors).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('keeps the dialog open rather than overwriting an existing column', async () => {
    const user = userEvent.setup();

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationTargets: JSON.stringify({ 'source-1': 'text' }),
          },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Annotation Column' }));
    await user.click(screen.getByRole('option', { name: 'Start new annotation' }));
    await user.type(screen.getByRole('textbox', { name: 'Column name' }), 'text');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByRole('alert')).toHaveTextContent('A column named "text" already exists.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mocks.polarsExpressionApply).not.toHaveBeenCalled();
    expect(mocks.setSetting).not.toHaveBeenCalled();
  });

  it('creates correction columns from the Manual toolbar without an example shortcut', async () => {
    const user = userEvent.setup();
    const setCorrectionColumn = vi.fn();
    mocks.sourceColumnNames = ['text', 'annotation', 'review'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationMode: 'manual',
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: { 'source-1': 'review' },
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn,
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.getByText('Correction: review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use as example' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create correction column' }));
    const columnName = screen.getByRole('textbox', { name: 'Correction column name' });
    expect(columnName).toHaveAttribute('placeholder', 'annotation.correction');
    await user.click(columnName);
    await user.tab();
    expect(columnName).toHaveValue('annotation.correction');
    expect(columnName).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(setCorrectionColumn).toHaveBeenCalledWith('source-1', 'annotation.correction');
    });
    expect(mocks.polarsExpressionApply).toHaveBeenCalledWith(
      'source-1',
      expect.objectContaining({
        expressions: [expect.objectContaining({ alias: 'annotation.correction' })],
      }),
      'update',
    );
  });

  it('clears the persisted correction-column draft with the task results', async () => {
    const user = userEvent.setup();
    const clearCorrectionColumns = vi.fn();
    mocks.sourceColumnNames = ['text', 'annotation', 'review'];

    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: null,
          activeAnalysis: null,
          inputSets: {},
          settings: {
            annotationMode: 'ai',
            annotationTargets: JSON.stringify({ 'source-1': 'annotation' }),
          },
          correctionColumns: { 'source-1': 'review' },
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns,
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear Results' }));

    await waitFor(() => {
      expect(mocks.clearResults).toHaveBeenCalledTimes(1);
      expect(clearCorrectionColumns).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a fatal classified Run All error inline', () => {
    const message = 'The provider rejected the saved credential. Update the API key in Settings.';
    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: runAllAnalysis('failed', message),
          activeAnalysis: null,
          inputSets: {},
          settings: { annotationMode: 'ai' },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('shows durable partial-success counts beside the Annotation result', () => {
    mocks.workspaceNodes = [{ id: 'source-1', color: '#2563eb', shape: [3, 2] }];
    mocks.runAllResult = { failed_row_count: 2, failed_batch_count: 1 };
    render(
      <AnnotationFeature
        host={{
          tabId: 'tab-1',
          analyses: [],
          latestPreview: null,
          latestRunAll: runAllAnalysis('succeeded'),
          activeAnalysis: null,
          inputSets: {},
          settings: { annotationMode: 'ai' },
          correctionColumns: {},
          setInputSet: mocks.setInputSet,
          setSetting: mocks.setSetting,
          setCorrectionColumn: vi.fn(),
          clearCorrectionColumns: vi.fn(),
          refreshAnalyses: vi.fn(),
        }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Annotation completed with 2 failed rows across 1 failed batch',
    );
    expect(screen.getByText('Run All review table')).toBeInTheDocument();
  });
});
